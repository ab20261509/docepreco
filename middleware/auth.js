function exigirLogin(req, res, next) {
  if (!req.session || !req.session.usuario) {
    return res.redirect('/login');
  }
  next();
}

module.exports = { exigirLogin };
