const { test, expect } = require('@playwright/test');
const fs = require('fs');
const path = require('path');

// Input and hardening checks from the security remediation plan (P1.2, P1.3,
// P3.1, P3.7, P4.1, N25, N26, N29). None of these need a database.

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-that-is-definitely-longer-than-32-bytes';

test.describe('food icons (P1.2, C01)', () => {
  const { foodIconImage, hasFoodIcon, buildIconMap } = require('../src/services/foodIcons');

  test('hostile ids never touch the filesystem', () => {
    // Build the map first, then watch for any further file access.
    expect(hasFoodIcon('apples_raw_with_skin')).toBe(true);
    const calls = [];
    const originals = {};
    for (const name of ['readFileSync', 'existsSync', 'statSync', 'openSync', 'realpathSync']) {
      originals[name] = fs[name];
      fs[name] = (...args) => { calls.push([name, String(args[0])]); return originals[name](...args); };
    }
    try {
      for (const id of ['../x', '..%2F..%2Fpackage', '/etc/passwd', 'a/b', '..\\..\\x', '', null, 'A'.repeat(65)]) {
        expect(foodIconImage(id)).toBeNull();
      }
    } finally {
      Object.assign(fs, originals);
    }
    expect(calls).toEqual([]);
  });

  test('a catalog icon still loads', () => {
    const image = foodIconImage('apples_raw_with_skin');
    expect(Buffer.isBuffer(image)).toBe(true);
    expect(image.subarray(1, 4).toString()).toBe('PNG');
  });

  test('symlinks leaving the icon directory are ignored', () => {
    const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'icons-'));
    try {
      fs.writeFileSync(path.join(dir, 'ok_food.png'), 'png');
      fs.symlinkSync(path.resolve('package.json'), path.join(dir, 'escape.png'));
      const map = buildIconMap(dir);
      expect([...map.keys()]).toEqual(['ok_food']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

test.describe('stored plan schema (P1.3, F05, F18)', () => {
  const { createPlanBody, sessionBody, pdfExportQuery } = require('../src/validation/schemas');
  const { generatePlan } = require('../src/features/planner/generator');
  const generated = generatePlan({
    weightKg: 78, heightCm: 178, age: 29, sex: 'male', activityLevel: 'moderate',
    goal: 'lose_weight', numberOfMeals: 4, mealDistribution: 'balanced',
  });
  const parse = (planData) => createPlanBody.safeParse({ name: 'Plan', planData });
  const withFood = (food) => {
    const plan = structuredClone(generated);
    plan.meals[0].items[0].food = food;
    return plan;
  };

  test('a generated plan is accepted as-is', () => {
    expect(parse(generated).success).toBe(true);
  });

  test('catalog foods are replaced by the server catalog entry', () => {
    const food = { ...generated.meals[0].items[0].food, name: '<img src=x onerror=alert(1)>', caloriesPer100g: 1e30 };
    const result = parse(withFood(food));
    expect(result.success).toBe(true);
    expect(result.data.planData.meals[0].items[0].food.name).toBe(generated.meals[0].items[0].food.name);
    expect(result.data.planData.meals[0].items[0].food.caloriesPer100g).toBe(generated.meals[0].items[0].food.caloriesPer100g);
  });

  test('retired planner fields are rejected at the API boundary', () => {
    for (const retiredField of ['ramadanMode', 'dietType', 'allergies', 'dislikes', 'customFood']) {
      const planData = structuredClone(generated);
      planData.input[retiredField] = retiredField === 'dietType' ? 'vegan' : true;
      expect(parse(planData).success, retiredField).toBe(false);
    }
  });

  test('assessment probes are rejected', () => {
    const probes = {
      objectFoodName: withFood({ id: 'custom_1', name: { toString: 'x' }, caloriesPer100g: 1, proteinGPer100g: 1, carbGPer100g: 1, fatGPer100g: 1 }),
      pathLikeFoodId: withFood({ id: '../../public/x', name: 'x', caloriesPer100g: 1, proteinGPer100g: 1, carbGPer100g: 1, fatGPer100g: 1 }),
      age999: { ...generated, input: { ...generated.input, age: 999 } },
      weightNegative: { ...generated, input: { ...generated.input, weightKg: -1 } },
      calories1e30: { ...generated, dailyTargets: { ...generated.dailyTargets, calories: 1e30 } },
      hugeGoal: { ...generated, input: { ...generated.input, goal: 'x'.repeat(5000) } },
      unboundedExtra: { ...generated, junk: 'x'.repeat(100 * 1024) },
    };
    for (const [name, planData] of Object.entries(probes)) {
      expect(parse(planData).success, name).toBe(false);
    }
  });

  test('a null session profile is rejected (F18)', () => {
    expect(sessionBody.safeParse({ idToken: 't', profile: null }).success).toBe(false);
    expect(sessionBody.safeParse({ idToken: 't' }).success).toBe(true);
  });

  test('PDF clientName is stripped of bidi and control characters (N25)', () => {
    const result = pdfExportQuery.safeParse({ clientName: 'Ali‮ce\u0007' });
    expect(result.success).toBe(true);
    expect(result.data.clientName).toBe('Alice');
  });
});

test.describe('LIKE escaping (N29)', () => {
  const { likePattern } = require('../src/shared/likePattern');
  test('wildcards in a search are matched literally', () => {
    expect(likePattern('50%')).toBe('%50\\%%');
    expect(likePattern('a_b')).toBe('%a\\_b%');
    expect(likePattern('a\\b')).toBe('%a\\\\b%');
  });
});

test.describe('error handling (P3.7)', () => {
  const { errorHandler } = require('../src/middleware/errorHandler');
  function run(error) {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const out = {};
    const res = { status(code) { out.status = code; return this; }, json(body) { out.body = body; return this; } };
    try {
      errorHandler(error, { id: 'r1', method: 'GET', originalUrl: '/x' }, res, () => {});
    } finally {
      process.env.NODE_ENV = previous;
    }
    return out;
  }

  test('an error without a status is a masked 500', () => {
    const out = run(new Error('JWT_SECRET is required.'));
    expect(out.status).toBe(500);
    expect(out.body.error).not.toContain('JWT_SECRET');
  });

  test('client errors keep their status and message', () => {
    const out = run(Object.assign(new Error('Choose a valid goal.'), { status: 400 }));
    expect(out).toEqual({ status: 400, body: { error: 'Choose a valid goal.', requestId: 'r1' } });
  });
});

test.describe('CSRF origin check (P3.1)', () => {
  const { createSameOriginOnly } = require('../src/middleware/sameOrigin');
  const check = createSameOriginOnly(new Set(['https://pincherize.vercel.app']));
  function run(method, headers) {
    const lower = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
    let status = 'next';
    const req = { method, id: 'r', cookies: {}, get: (name) => lower[name.toLowerCase()] };
    const res = { status(code) { status = code; return this; }, json() { return this; } };
    check(req, res, () => {});
    return status;
  }

  test('only the exact app origin may send unsafe requests', () => {
    expect(run('POST', { Origin: 'https://pincherize.vercel.app' })).toBe('next');
    expect(run('POST', { Origin: 'https://pincherize.vercel.app.evil.com' })).toBe(403);
    expect(run('POST', { Origin: 'http://pincherize.vercel.app' })).toBe(403);
    expect(run('POST', { Referer: 'https://evil.example/pincherize.vercel.app' })).toBe(403);
    expect(run('DELETE', { Origin: 'null' })).toBe(403);
  });

  test('Fetch Metadata cross-site requests are rejected', () => {
    expect(run('POST', { Origin: 'https://pincherize.vercel.app', 'Sec-Fetch-Site': 'cross-site' })).toBe(403);
  });

  test('no Origin is allowed only without a session cookie', () => {
    expect(run('POST', {})).toBe('next');
    expect(run('POST', { Cookie: '__Host-session=abc' })).toBe(403);
    expect(run('GET', { Cookie: '__Host-session=abc' })).toBe('next');
  });
});

test.describe('log redaction (P4.1)', () => {
  const { redact } = require('../src/utils/logger');
  test('secrets and tokens never reach a log line', () => {
    const jwtLike = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJlLXZhbHVl';
    const out = JSON.stringify(redact({
      idToken: 'secret', nested: { Authorization: 'Bearer abc', cookie: 'session=1' },
      message: `failed with ${jwtLike}`, note: 'Bearer abcdefghijklmnop', tokenVersion: 2,
    }));
    expect(out).not.toContain('secret');
    expect(out).not.toContain(jwtLike);
    expect(out).not.toContain('abcdefghijklmnop');
    expect(out).toContain('"tokenVersion":2');
  });
});

test.describe('generation worker memory limit (N26)', () => {
  const { PlanGenerationPool } = require('../src/features/planner/generationPool');

  test('an oversized job kills only its own worker', async () => {
    const pool = new PlanGenerationPool({
      workerCount: 1,
      jobTimeoutMs: 20000,
      workerPath: path.join(__dirname, 'fixtures', 'memoryHogWorker.js'),
      resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8 },
    });
    try {
      await expect(pool.run({ hog: true })).rejects.toMatchObject({
        status: 503,
        code: 'generation-worker-out-of-memory',
      });
      await expect(pool.run({ hog: false })).resolves.toMatchObject({ plan: { ok: true } });
    } finally {
      await pool.close();
    }
  });
});
