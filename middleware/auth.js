const { canAccessModule } = require('./permissions.js');

function requireLogin(req, res, next) {
  if (!req.session || !req.session.user) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  next();
}

function requireModule(moduleName) {
  return (req, res, next) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not logged in' });
    if (!canAccessModule(req.session.user.role, moduleName)) {
      return res.status(403).json({ error: `Your role (${req.session.user.role}) does not have access to ${moduleName}` });
    }
    next();
  };
}

function requireRole(...roles) {
  const flat = roles.flat(); // defensive: handle requireRole(['a','b']) AND requireRole('a','b')
  return (req, res, next) => {
    if (!req.session || !req.session.user) return res.status(401).json({ error: 'Not logged in' });
    if (!flat.includes(req.session.user.role)) {
      return res.status(403).json({ error: 'You do not have permission to perform this action. Please contact your System Administrator.' });
    }
    next();
  };
}

module.exports = { requireLogin, requireModule, requireRole };
