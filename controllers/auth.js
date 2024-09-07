const bcrypt = require('bcryptjs');
const nodemailer = require('nodemailer');
const sendGridTransport = require('nodemailer-sendgrid-transport');
const dotenv = require('dotenv');

const User = require('../models/user');

dotenv.config();

const transporter = nodemailer.createTransport(
  sendGridTransport({
    auth: {
      api_key: process.env.NODEMAILER_API_KEY,
    },
  })
);

exports.getLogin = (req, res, next) => {
  let message = req.flash('loginError');
  if (message.length > 0) {
    message = message[0];
  } else {
    message = null;
  }
  res.render('auth/login', {
    path: '/login',
    pageTitle: 'Login',
    errorMessage: message,
  });
};

exports.postLogin = (req, res, next) => {
  const email = req.body.email;
  const password = req.body.password;
  User.findOne({ email: email })
    .then((user) => {
      if (!user) {
        req.flash('loginError', 'Invalid email or password.');
        console.log('User Not Found');
        return res.redirect('/login');
      }
      bcrypt
        .compare(password, user.password)
        .then((doMatch) => {
          if (doMatch) {
            req.session.user = user;
            req.session.isLoggedIn = true;
            return req.session.save((err) => {
              if (err) {
                console.log(err);
              } else {
                console.log('Login Successful');
              }
              res.redirect('/'); // Only redirect once session is saved to the db
            });
          }
          req.flash('loginError', 'Invalid email or password.');
          res.redirect('/login');
        })
        .catch((err) => {
          console.log(err);
          res.redirect('/login');
        });
    })
    .catch((err) => {
      console.log(err);
    });
};

exports.getSignup = (req, res, next) => {
  let message = req.flash('signUpError');
  if (message.length > 0) {
    message = message[0];
  } else {
    message = null;
  }
  res.render('auth/signup', {
    path: '/signup',
    pageTitle: 'Signup',
    errorMessage: message,
  });
};

exports.postSignup = (req, res, next) => {
  const email = req.body.email;
  const password = req.body.password;
  const confirmPassword = req.body.confirmPassword;

  User.findOne({ email: email })
    .then((userDoc) => {
      if (userDoc) {
        req.flash(
          'signUpError',
          'E-Mail exists already, please pick a different one.'
        );
        return res.redirect('/signup');
      }
      return bcrypt
        .hash(password, 12)
        .then((hashedPass) => {
          const user = new User({
            email: email,
            password: hashedPass,
            cart: { items: [] },
          });

          return user.save();
        })
        .then(() => {
          res.redirect('/login');

          return transporter
            .sendMail({
              to: email,
              from: process.env.FROM_EMAIL,
              subject: 'Signup succeeded!',
              html: '<h1>You successfully signed up!</h1>',
            })
            .catch((err) => {
              console.log(err);
            });
        });
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
