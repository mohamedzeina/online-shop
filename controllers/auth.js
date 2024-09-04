exports.getLogin = (req, res, next) => {
  const authCookie = req.get('Cookie').split(';')[2].trim().split('=')[1];
  console.log(authCookie);
  res.render('auth/login', {
    path: '/login',
    pageTitle: 'Login',
    isAuthenticated: authCookie,
  });
};

exports.postLogin = (req, res, next) => {
  res.setHeader('Set-Cookie', 'loggedIn=true');
  res.redirect('/');
};
