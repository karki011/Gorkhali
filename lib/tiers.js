// Author: Subash Karki
//
// Tier and model resolution for Gorkhali agents.
// Six roles map onto three tiers (config/role-tiers.json); each host maps
// those three tiers onto a model (config/hosts/<host>.json). An explicit
// model override always wins. An unknown host falls back to inheriting
// whatever model is already active (returns null).

const path = require('node:path');

const roleTiers = require(path.join(__dirname, '..', 'config', 'role-tiers.json'));

function tierForRole(role) {
  const key = typeof role === 'string' ? role.trim().toLowerCase() : role;
  return roleTiers[key] || null;
}

function loadHostMap(host) {
  try {
    // eslint-disable-next-line global-require, import/no-dynamic-require
    return require(path.join(__dirname, '..', 'config', 'hosts', `${host}.json`));
  } catch {
    return null;
  }
}

function modelForTier(tier, host, explicitModel) {
  if (typeof explicitModel === 'string' && explicitModel.trim()) {
    return explicitModel.trim();
  }

  const hostKey = typeof host === 'string' ? host.trim().toLowerCase() : host;
  const hostMap = hostKey ? loadHostMap(hostKey) : null;
  if (!hostMap) return null;

  return hostMap[tier] || null;
}

module.exports = { tierForRole, modelForTier };
