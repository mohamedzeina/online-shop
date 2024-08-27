const path = require('path');

const express = require('express');
const router = express.Router();

router.get('/', (req, res, next) => {
  res.sendFile(path.join(__dirname, '../', 'views', 'shop.html')); // __dirname holds path of project folder of this current file
});

module.exports = router;
