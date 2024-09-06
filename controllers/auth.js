exports.getLogin = (req, res, next) => {
  const authCookie = req.session.isLoggedIn;
  console.log(authCookie);
  res.render('auth/login', {
    path: '/login',
    pageTitle: 'Login',
    isAuthenticated: authCookie,
  });
};

exports.postLogin = (req, res, next) => {
  req.session.isLoggedIn = true;
  res.redirect('/');
};
