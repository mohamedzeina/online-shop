const mysql = require('mysql2');

const pool = mysql.createPool({
  host: 'localhost',
  username: 'root',
  database: 'onlineshop',
  password: '123456',
});

module.exports = pool.promise();
