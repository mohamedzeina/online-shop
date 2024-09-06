const User = require('../models/user');

exports.getLogin = (req, res, next) => {
  authCookie = req.session.isLoggedIn;
  console.log();
  res.render('auth/login', {
    path: '/login',
    pageTitle: 'Login',
    isAuthenticated: authCookie,
  });
};

exports.postLogin = (req, res, next) => {
  User.findById('66d84edb1f636465313154a6')
    .then((user) => {
      req.session.user = user;
      req.session.isLoggedIn = true;
      res.redirect('/');
    })
    .catch((err) => {
      console.log(err);
    });
};

exports.postLogout = (req, res, next) => {
  req.session.destroy((err) => {
    console.log(err);
    res.redirect('/');
  }); // Deleting the session from the db
};
