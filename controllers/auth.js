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
      req.session.save((err) => {
        console.log(err);
        res.redirect('/'); // Only redirect once session is saved to the db
      });
    })
    .catch((err) => {
      console.log(err);
    });
};

exports.getSignup = (req, res, next) => {
  res.render('auth/signup', {
    path: '/signup',
    pageTitle: 'Signup',
    isAuthenticated: false,
  });
};

exports.postSignup = (req, res, next) => {};

exports.postLogout = (req, res, next) => {
  req.session.destroy((err) => {
    console.log(err);
    res.redirect('/');
  }); // Deleting the session from the db
};
