# node.js blob service gateway.
The blob service provides an S3-compatible HTTP endpoint to an underlying storage provider. A driver model is used for different providers. Currently the available drivers include S3 (Amazon web services) or a local file system (FS) driver.

## Authors
- Sonic Wang (wangs@vmware.com)

## Features
- RESTful web service
- Plugin model (currently support local fs, s3)
- streaming in/out blobs
- basic blob operations: create/delete/get/copy
- create/list/delete buckets
- enumerate with prefix/delimiter/marker/max-keys
- user defined meta data
- S3 compatibility and limited S3 pass-thru (bucket configs, headers, etc)

## API Documentation
- see [doc](doc) directory

## Dependencies
- Express, web framework 
- Winston, logging module

## Submodules
- node-mongodb-native: mongoDB interface
- sax-js: xml parser

## Installing node.js
The blob service depends on [node.js](http://nodejs.org/). We are working with the v0.4 branch and v0.4.9 tag.  

To match the same branch and tag from github:

    $> git clone -b v0.4 https://github.com/joyent/node.git <target-directory>
    $> cd <target-directory>
    $> git checkout v0.4.9

To build node.js (sudo?)

    ./configure
    make
    make install

## Installing npm
Most node.js applications require modules distributed via npm. Instructions for installing npm can be found at [npmjs.org](http://npmjs.org/).

## Deploying the blob service from source

    $> git clone <project-url> <target-directory>
    $> cd <target-directory>
    $> git submodule init
    $> git submodule update
    $> cd blob_fs/node-mongodb-native
    $> make
    $> cd ../..
    $> cp config.json.sample config.json
    
now edit `config.json`
    
Note that the Blob service uses the BSON component inside node-mongodb-native which requires a native binary to be compiled and installed.


## FS driver: MongoDB setup
The FS driver uses MongoDB for storing metadata about each object in the file system. For every bucket there is a separate collection with the same name as the bucket. Each instance of the gateway requires its own MongoDB database.

- start mongo: E.g. `$> mongod -f mongodb.config` (adjust to correct config file location - config file points to db location)
- note port on startup (to match `mds.port` option in config.json)
- start mongo console: `$> ./mongo` in bin folder

Inside the mongo shell:

- create database, e.g.: `> use test` (note db name to match `mds.db` option)
- setup user account, e.g.: `> db.addUser('<user>', '<password>')` (to match `mds.user` and `mds.pwd` options)

Subsequent uses of the blob service simply require mongo to be running.

# S3 driver setup
- The S3 driver requires a valid id/key pair from your Amazon S3 storage account (no additional metadata storage is used)

## Gateway configuration via config.json

    {
      "drivers":[
        {"fs-sonic" : {
          "type" : "fs",
          "option" : {"root" : "/home/sonicwcl/Workspace/data2",
               "mds" : {
                  "host" : "127.0.0.1",
                  "port" : "28100",
                  "db"   : "test2",
                  "user" : "sonic1",
                  "pwd"  : "password1"
               }
            }
          }
        },
        {"s3-sonic" : {
          "type" : "s3",
          "option" : {
            "key" : "dummy",
            "secret" : "dummy"
            }
          }
        }
      ],
      "port" : "8080",
      "default" : "s3-sonic",
      "logfile" : "/var/vcap/services/blob/instance/log",
      "keyID" : "dummy",
      "secretID" : "dummy",
      "auth" : "enabled"
    }


Each driver must specify its type. Currently `fs` and `s3` are supported. The `option` values depend on the driver type. For `fs`, the option values inlucde the  root directory for storing blobs and the host/port/db/user/password for mongodb. For `s3`, the option values are the s3 key and secret. 

`default` is used to specify the driver to be used by the service at startup. Only 1 driver can be in use at any time. If no default is specified the first driver will be used.

`logfile` specifies the path to log file. 

"keyID" and "secretID" and "auth" are used to control authentication. If either the key or id is not present or if auth is not set to "enabled" then authentication is disabled. 

## Usage

    node server.js [-f path_to_config_file]
    
## Testing
Unit tests depend on vows. To install fetch:

    npm install -g vows
    
To run testbasic.js, first make sure server.js is configured and running with one of the drivers, then

    cd test
    vows testbasic.js --spec


## Manual usage with curl
The following curl commands assume: 

- authentication is NOT enabled. (set `"auth":"disabled"` in config.json) 
- the node.js process is running on localhost and listening on port 3000.

### Listing buckets

    curl http://localhost:3000 -v

### Listing a bucket
  
    curl http://localhost:3000/container1 -v

One could add a query to the URL. Currently four criteria are supported: prefix; delimiter; marker; max-keys. E.g.:

    curl "http://localhost:3000/container1/?prefix=A/&delimiter=/" -v

The above query will also list virtual folders in result as well.

### Create a bucket

    curl http://localhost:3000/container1 -X PUT -v

### Delete a bucket

    curl http://localhost:3000/container1 -X DELETE -v

### Uploading a file

    curl http://localhost:3000/container1/file1.txt -X PUT -T file1.txt -v

Currently user-defined meta data is supported. All user meta keys start with prefix `x-amz-meta-`. E.g.:

    curl http://localhost:3000/container1/file1.txt -X PUT -T file1.txt -H "x-amz-meta-comment:hello_world"

### Copying a file

    curl http://localhost:3000/container1/file1.txt -X PUT -H "x-amz-copy-source:/container2/file2.txt"

The above request will direct gateway to copy file2.txt in container2 to file1.txt in container1. Currently only intra-driver copy is supported. This means both container1 and container2 must be within the same driver(backend). This operation will copy meta data as well. All user-defined meta data in file2.txt will be copied to file1.txt. 

This operation will return code `200`. In addition, the response body includes a JSON format object. It has two fields: `LastModified`, and `ETag`. 

### Deleting a file

    curl http://localhost:3000/container1/file1.txt -X DELETE -v

### Reading a file

    curl http://localhost:3000/container1/file1.txt -v

Currently additional header `range` is supported for single range read as well. Thus user can issue something like this:

    curl http://localhost:3000/container1/file1.txt -H "range:bytes=123-892" -v

## S3 compatibility

There is strong demand for an S3 compatibility. Thus we implement front end APIs to be S3 compatible. This means urls, headers and request bodies are all S3 compatible. At the same time, responses will be S3 compatible as well. For more details see the REST api documentation in the doc directory.

## Server Tuning

When gateway is handling a great amount of concurrent requests, it may open too many file descriptors. It is suggested to increase the file descriptor limit. E.g.: in linux one may type

    ulimit -n 16384

