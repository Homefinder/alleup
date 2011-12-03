var formidable = require('formidable')
  , util = require('util')
  , im = require('imagemagick')
  , fs = require('fs')
  , path = require('path')
  , hat = require('hat')
  , rack = hat.rack()
  , knox = require('knox');

var config_file = './alleup.json'
  , config = {}
  , s3client = undefined
  , uploaddir = undefined
  , storage_type = undefined;

var Alleup = exports = module.exports = function Alleup(options) {
  config_file = (typeof options['config_file'] === 'undefined')
    ? config_file : options['config_file'];
  storage_type = options['storage'];

  this.loadConfig(config_file);

  var storageCheck = config['storage']['aws'] || config['storage']['dir'];
  if (typeof storageCheck == 'undefined')
    throw new TypeError('No storage defined in alleup config');

  for(storage in config['storage']) {
    this[storage + 'Setup'](config['storage'][storage]);
  }
};

Alleup.prototype = {

  url: function(file, version) {
    var _file = this.genFileName(file, version);
    return this[storage_type + 'Url'](_file);
  },

  dirUrl: function(file) {
    return uploaddir + file;
  },

  awsUrl: function(file) {
    return s3client.url( file );
  },

  genFileName: function(file, version) {
    return version + '_' + file;
  },

  remove: function(file, callback) {
    var _resize = config['variants']['resize']
      , _crop = config['variants']['crop'];

    for(version in _resize) {
      var fileName = this.genFileName(file, version);
      this[storage_type + 'Remove'](fileName, function(err) {
        callback(err);
      });
    };

    for(version in _crop) {
      var fileName = this.genFileName(file, version);
      this[storage_type + 'Remove'](fileName, function(err) {
        callback(err);
      });
    };

    return callback(null);
  },

  awsRemove: function(file, callback) {
    s3client.deleteFile(file, function(err, res) {
      callback(err);
    });
  },

  dirRemove: function(file, callback) {
    fs.unlink(uploaddir + file, function(err) {
      return callback(err);
    });
  },

  upload: function(req, res, callback) {
    var self = this
      , form = new formidable.IncomingForm()
      , files = []
      , fields = []
      , new_file = undefined;

    form
      .on('field', function(field, value) {
        fields.push([field, value]);
      })
      .on('file', function(field, file) {
        files.push([field, file]);
        new_file = file;
      })
      .on('end', function() {
        self.makeVariants(new_file, function(err, file) {
          callback(err, file, res);
        });
      });

    form.parse(req);
  },

  awsSetup: function(options) {
    s3client = knox.createClient({
        key: options['key']
      , secret: options['secret']
      , bucket: options['bucket']
    });
  },

  dirSetup: function(options) {
    uploaddir = options['path'];
  },

  makeVariants: function(file, callback) {
    var self = this
      , _resize = config['variants']['resize']
      , _crop = config['variants']['crop']
      , new_file = rack()
      , ext = this.setExtension(file['type']);
    new_file += ext;

    var i = 0;
    for(prefix in _resize) {
      var fileName = this.genFileName(new_file, prefix);
      this.imAction(
        'im.resize', file, fileName, _resize[prefix],
      function(err) {
        i++;
        if (i == Object.keys(config.variants.resize).length) {
          i = 0;
          for(prefix in _crop) {
            var fileName = self.genFileName(new_file, prefix);
            self.imAction(
              'im.crop', file, fileName, _crop[prefix],
            function(err) {
              i++;
              if (i == Object.keys(config.variants.crop).length) {
                fs.unlink(file['path']);
                callback(err, new_file);
              } else {
                callback(err, new_file);
              }
            });
          };
        };
      });
    };
  },

  pushToS3: function(sfile, dfile, content_type, callback) {
    fs.readFile(sfile, function(err, buf) {
      var req = s3client.put(dfile, {
          'Content-Length': buf.length
        , 'Content-Type': content_type
      });

      req.on('response', function(res) {
        if (200 == res.statusCode) {
          fs.unlink(sfile);
          callback(err);
        } else {
          callback(err);
        }
      });

      req.end(buf);
    });
  },

  loadConfig: function(resource) {
    if (path.existsSync(resource)) {
      try {
        config = JSON.parse(fs.readFileSync(resource));
      } catch (err) {
        var msg = 'Could not parse JSON config at ' + path.resolve(resource);
        throw new Error(msg);
      }
    }
  },

  imAction: function(action, file, prefix, size, callback) {
    var self = this
      , dfile = '/' + prefix.split('_')[1].substr(0,4) + '/' + prefix
      , tfile = (storage_type === 'dir')
          ?  uploaddir + prefix : file['path'] + prefix
      , imOptions = this.imOptions(file, tfile, size);

    eval(action)(imOptions, function(err, stdout, stderr) {
      if (storage_type === 'aws') {
        self.pushToS3(tfile, dfile, file['type'], function(err) {
          return callback(err);
        });
      } else {
        return callback(err);
      }
    });
  },

  setExtension: function(content_type) {
    switch(content_type) {
      case 'image/jpeg':
        var ext = '.jpg'
        break;
      case 'image/png':
        var ext = '.png'
        break;
      case 'image/gif':
        var ext = '.gif'
        break;
    };

    return ext;
  },

  imOptions: function(file, tfile, size) {
    var _size = size.split('x');

    return options = {
      srcPath: file['path'],
      dstPath: tfile,
      width: _size[0],
      height: _size[1],
      quality: 1
    };
  }
};
