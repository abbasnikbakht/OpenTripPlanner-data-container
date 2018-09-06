const col = require('ansi-colors');
const crypto = require('crypto');
const fs = require('fs');
const request = require('request');

const {dataDir} = require('../config');

/**
 * Compare Content-MD5 header md5 hash value to hash value calculated from local a copy of the file.
 */
const compareHashes = (headerHash, localFilePath) => {
  return new Promise((resolve, reject) => {
    let shasum = crypto.createHash('md5');
    let s = fs.ReadStream(localFilePath);
    // Download file as it's not found locally
    s.on('error', function(err) {
      process.stdout.write(col.red(err));
      reject('error');
    });
    s.on('data', function(data) {
      shasum.update(data);
    });
    s.on('end', function() {
      var fileHash = shasum.digest('base64');
      if (fileHash === headerHash) {
        resolve(true);
      } else {
        reject('end');
      }
    });
  });
}

/**
 * Download DEM files from Azure blob storage.
 */
module.exports = function(entries){
  return entries.map((entry) => {
    return new Promise((resolve, reject) => {
      const filePath = `${dataDir}/downloads/dem/${entry.id}.tif`;
      const readyPath = `${dataDir}/ready/dem/${entry.id}.tif`;
      let dataAlreadyExists = false;
      let downloadHash;
      const r = request(entry.url);
      r.pipe(fs.createWriteStream(filePath));
      r.on('response', response => {
        downloadHash = response.headers['content-md5'];
        compareHashes(downloadHash, readyPath)
          .then((resolved) => {
            if (resolved) {
              process.stdout.write(col.green(`Local DEM data for ${entry.id} was already up-to-date\n`));
              dataAlreadyExists = true;
              // Abort download as remote has same md5 as local copy
              r.abort();
            }
          }).catch((err) => {
            if (err === 'end') {
              process.stdout.write(col.green(`${entry.url} hash value differs from local file's hash value\n`));
              process.stdout.write(col.green(`Downloading new DEM data from ${entry.url}\n`));
            } else if (err === 'error') {
              process.stdout.write(col.red(`\nFailed to load local DEM data for ${entry.id}\n`));
              process.stdout.write(col.green(`Downloading new DEM data from ${entry.url}\n`));
            } else {
              process.stdout.write(col.red(err));
              process.stdout.write(col.red(`\nFailed to load local DEM data for ${entry.id}\n`));
              process.stdout.write(col.green(`Downloading new DEM data from ${entry.url}\n`));
            }
          });
      });
      r.on('error', err => {
        process.stdout.write(col.red(err));
        process.stdout.write(col.green(`\nFailed to load new DEM data for ${entry.id}\n`));
        reject();
      });
      r.on('end', () => {
        // If new file was downloaded, this resolves with the file's path
        // This is also called when request is aborted but new call to resolve shouldn't do anything
        // However, if the file is really small, this could in theory be called before call to abort request
        // but that situation shouldn't happen with DEM data sizes.
        if (!dataAlreadyExists) {
          compareHashes(downloadHash, filePath)
            .then((resolved) => {
              if (resolved) {
                process.stdout.write(col.green(`Downloaded updated DEM data to ${filePath}\n`));
                fs.rename(path, path.replace('/downloads/', '/ready/'), (err) => {
                  if (err) {
                    process.stdout.write(col.red(err));
                    process.stdout.write(col.red(`\nFailed to move DEM data from ${readyPath}\n`));
                  } else {
                    process.stdout.write(col.green(`DEM data update process was successful ${readyPath.split('/').pop()}\n`));
                  }
                });
                resolve();
              }
            }).catch((err) => {
              if (err === 'end') {
                process.stdout.write(col.red(`${entry.url} hash value differs from just downloaded file's hash value\n`));
              } else if (err === 'error') {
                process.stdout.write(col.red(`\nFailed to load local DEM data for ${entry.id}\n`));
              } else {
                process.stdout.write(col.red(err));
              }
              reject();
            });
          } else {
            resolve();
          }
        });
    });
  });
}
