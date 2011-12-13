# node.js blob service gateway.

Copyright (c) 2011 VMware, Inc.

The blob service provides an S3-compatible HTTP endpoint to an underlying storage provider. A driver model is used for different providers. Currently the available drivers include S3 (Amazon web services) or a local file system (FS) driver.

## Authors
- Sonic Wang (wangs@vmware.com)

## Features
- RESTful web service
- S3 compatibility
- plugin model (currently support local fs, s3)
- streaming in/out blobs
- basic blob operations: create/delete/get/copy
- create/list/delete buckets
- s3 driver: enumerate with prefix/delimiter/marker/max-keys
- user defined meta data

## API Documentation
- see [doc](doc) directory

## Dependencies
The following 3rd party npm modules have been included in the node_modules subdirectory

- express: web framework 
- winston: logging module
- sax: xml parser
- vows: test framework

## Installing node.js
The blob service depends on [node.js](http://nodejs.org/). We are working with the v0.4 branch and v0.4.12 tag.  

To match the same branch and tag from github:

    $> git clone -b v0.4 https://github.com/joyent/node.git <target-directory>
    $> cd <target-directory>
    $> git checkout v0.4.12

To build node.js (sudo?)

    ./configure
    make
    make install

## Installing npm
Most node.js applications require modules distributed via npm. Instructions for installing npm can be found at [npmjs.org](http://npmjs.org/).

## Deploying the blob service from source

    $> git clone <project-url> <target-directory>
    $> cd <target-directory>
    $> cp config.json.sample config.json
    
now edit `config.json`

## FS driver setup
The FS driver uses directories and files starting at a "root" location in the local file system. For scalability, the fs driver design supports multiple instances of the gateway operating on the same files. Metadata and blobs live in separate physical files in different directories. New files do not replace existing files until they have been fully uploaded and persisted. Old files are cleaned up using garbage collection processes which run in the background.

## S3 driver setup
The S3 driver requires a valid id/key pair from your Amazon S3 storage account (no additional metadata storage is used)

## Configuration via config.json
The gateway and its drivers can be configured via config.json which is read at startup. Values that need to be configured are indicated with `<value>`. Drivers are assumed to live under `./drivers/<type>` -- currently only `fs` and `s3` driver types are included.  

    {
        "drivers": [
        {
            "<fs-driver-name>": {
                "type": "fs",
                "option": {
                    "root": "<pathname for storing blobs>",
                    "node_exepath": "<optional: path to node executable>",
                    "compactor" : <true to enable enumeration compactor, don't enable multiple compactor instances!>,
                    "gc_exepath": "<optional: path to gc js file, e.g. /<vblob>/blob_fs/fs_gc.js >",
                    "gc_interval": "<optional: ms per gc execution, e.g. 600000 (10 mins) >",
                    "gcfc_exepath": "<optional: path to lightweight gc js file, e.g. /<vblob>/blob_fs/fs_gcfc.js >",
                    "gcfc_interval": "<optional: ms per lightweiht gc execution, e.g. 1500 (1.5 secs) >",
                    "gctmp_exepath": "<optional: path to tmp folder gc js file, e.g. /<vblob>/blob_fs/fs_gctmp.js >",
                    "gctmp_interval": "<optional: ms per tmp folder gc execution, e.g. 1 hr >",
                    "ec_exepath": "<path to ec js file, e.g. /<vblob>/blob_fs/fs_ec.js >",
                    "ec_interval": "<ms per ec execution, e.g. 1500 (1.5 secs) >",
                    "quota": <maximum number of bytes allowed to store, default is unlimited>,
                    "obj_limit" : <maximum number of objects allowed to store, default is unlimited>
                }
            }
        },
        {
            "<s3-driver-name>": {
                "type": "s3",
                "option": {
                    "key": "<s3 key>",
                    "secret": "<s3 secret>"
                }
            }
        }
        ],
        "port": "<port>",
        "current_driver": "<driver-name>",
        "logtype": "winston",
        "logfile": "<pathname for the log>",
        "keyID": "<any id for auth>",
        "secretID": "<any secret for auth>",
        "auth": "enabled",
        "debug": true
    }

`current driver` is used to specify the driver to be used by the service at startup. Only 1 driver can be in use at any time. If no default is specified the first driver will be used.

`logfile` specifies the path to the log file. The `logtype` has to be [winston](https://github.com/indexzero/winston).

`keyID` and `secretID` and `auth` are used to control front-end authentication. If either the key or id is not present or if auth is not set to "enabled" then authentication is disabled. 

`debug` is used to log request and response headers to the console for debugging purposes. Its value is treated as boolean.

## Usage

    node server.js [-f path_to_config_file]
    
Note that `-f config-path` is optional. The gateway will look for `./config.json`.

## Testing
To run the full set of unit tests, first make sure server.js is configured and running with one of the drivers, then

    cd test
    ../node_modules/vows/bin/vows test*.js --spec

NOTE: To install vows globally, use `npm install -g vows`  
        
## Manual usage with curl
The following curl commands assume:

- authentication is NOT enabled. (set `"auth":"disabled"` in config.json) 
- the node.js process is running on localhost and listening on port 3000.

### Listing all buckets

    curl http://localhost:3000 -v

### Listing objects in a bucket
(This feature is only enabled for the s3 driver)
  
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

## Using s3-curl with gateway authentication

Instead of using curl with authentication disabled, the gateway can also be accessed in an authenticated fashion via s3-curl.pl which is a utility for making signed requests to s3 available on [aws](http://aws.amazon.com/code/128). 

Credentials for authentication via s3-curl are stored in `.s3curl` as follows

    %awsSecretAccessKeys = (

        # real s3 account
        s3 => {
            id => '<s3-id>',
            key => '<s3-key',
        },

       gateway => {
            id => '<gateway-id>',
            key => '<gateway-key>',
        },
    );

Requests are then performed by specifying which credentials to use on the command line. Parameters for `curl` go after the `--`. E.g.

    ./s3curl.pl --id gateway -- -X DELETE -v http://localhost:3000/BucketToDelete

A small modification is required to add the endpoint where the gateway is running to the list of endpoints in the perl script. E.g. if you are running on localhost, you would add localhost to the @endpoints array as follows:

    # begin customizing here
    my @endpoints = ( 's3.amazonaws.com',
                      's3-us-west-1.amazonaws.com',
                      's3-eu-west-1.amazonaws.com',
                      's3-ap-southeast-1.amazonaws.com',
                      's3-ap-northeast-1.amazonaws.com',
                      'localhost' );

## Server Tuning

When the gateway is handling a large number of concurrent requests, it may open too many file descriptors. It is suggested to increase the file descriptor limit. E.g.: in unix-type systems:

    ulimit -n 16384
