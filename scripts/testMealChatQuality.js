const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const plannerHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'planner.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
const controller = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'generationController.js'), 'utf8');

assert(!plannerHtml.includes('Ask about this meal'), 'planner should not expose AI meal chat input');
assert(!plannerHtml.includes('Apply to Meal'), 'planner should not expose AI draft application');
assert(!appJs.includes("chatPanel.open"), 'frontend should not open AI chat');
assert(controller.includes('AI meal chat is disabled'), 'meal chat endpoint should be disabled');
assert(controller.includes('AI meal editing is disabled'), 'guided AI endpoint should be disabled');

console.log('meal chat disabled tests passed');
