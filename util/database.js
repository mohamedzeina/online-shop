const mongodb = require('mongodb');
const MongoClient = mongodb.MongoClient;

let _db;

const mongoConnect = (callback) => {
  MongoClient.connect(
    'mongodb+srv://toxiczeina:shjZPqvFPxW1yKSp@node-complete.r6fat.mongodb.net/shop?retryWrites=true&w=majority&appName=node-complete'
  )
    .then((client) => {
      console.log('Connected to DB Successfully!');
      _db = client.db();
      callback();
    })
    .catch((err) => {
      console.log(err);
      throw err;
    });
};

const getDb = () => {
  if (_db) {
    return _db;
  }
  throw 'No database found!';
};

exports.mongoConnect = mongoConnect;
exports.getDb = getDb;
