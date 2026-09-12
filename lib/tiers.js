// Logical policy is separate from the only supported host: Claude Code.
'use strict';
const roles = require('../config/role-tiers.json');
const claude = require('../config/hosts/claude-code.json');
function policyForRole(role) {
  const key = typeof role === 'string' ? role.trim().toLowerCase() : '';
  return Object.hasOwn(roles, key) ? roles[key] : null;
}
function tierForRole(role) { return policyForRole(role)?.default || null; }
function allowedTiers(role) { return [...(policyForRole(role)?.allowed || [])]; }
function modelForTier(tier, host = 'claude-code', explicitModel) {
  if (host !== 'claude-code') return null;
  if (typeof explicitModel === 'string' && tierForModel(explicitModel)) return explicitModel.trim();
  return Object.hasOwn(claude, tier) ? claude[tier] : null;
}
function tierForModel(model) {
  if (typeof model !== 'string') return null;
  const value = model.trim().toLowerCase();
  for (const [tier, family] of Object.entries(claude)) {
    if (value === family || new RegExp(`^claude-${family}-\\d+(?:[.-]\\d+)*$`).test(value) ||
        new RegExp(`^claude-\\d+(?:-\\d+)?-${family}-\\d+$`).test(value)) return tier;
  }
  return null;
}
module.exports = { tierForRole, allowedTiers, modelForTier, tierForModel };
