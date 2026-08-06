const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');

const plannerHtml = fs.readFileSync(path.join(__dirname, '..', 'public', 'planner.html'), 'utf8');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'app.js'), 'utf8');
const controller = fs.readFileSync(path.join(__dirname, '..', 'src', 'controllers', 'generationController.js'), 'utf8');

assert(plannerHtml.includes('Ask about this meal'), 'planner should expose AI meal chat input');
assert(plannerHtml.includes('Apply to Meal'), 'planner should expose AI draft application');
assert(appJs.includes('async openAndSend'), 'frontend should keep the AI chat send helper');
assert(!controller.includes('AI meal chat is disabled'), 'meal chat endpoint should be enabled');
assert(!controller.includes('AI meal editing is disabled'), 'guided AI endpoint should be enabled');
assert(controller.includes('You are a friendly meal assistant.'), 'meal chat prompt should be present');
assert(controller.includes('Do not bring those deleted foods back'), 'guided AI prompt should preserve remove-food intent');
assert(controller.includes('adding exactly one AVAILABLE food that fixes the missing macro/calorie gap'), 'guided AI prompt should tell AI to repair failed removals by adding a replacement food');
assert(!controller.includes('buildGuidedDeterministicSuggestion'), 'guided replacement suggestions should come from AI, not deterministic rescue');

console.log('meal chat enabled tests passed');
