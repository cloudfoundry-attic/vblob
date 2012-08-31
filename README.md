# node.js blob service gateway.

Copyright (c) 2011-2012 VMware, Inc.

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
- enumerate objects with prefix/delimiter/marker/max-keys
- user defined meta data

## FS driver
For scalability, the file system driver supports multiple instances of the gateway operating on the same files. Metadata and blobs live in separate physical files in different directories. New files do not replace existing files until they have been fully uploaded and persisted. Old files are cleaned up using garbage collection processes which run in the background.

The file system driver was designed to provide consistency without the use of any database. It depends on the file system for reference-counting hard links and atomic 'mv' operations.

## API Documentation
- For details of supported API features see the [doc](doc) directory

## Dependencies
The following 3rd party npm modules have been included in the node_modules subdirectory

- express: web framework 
- winston: logging module
- sax: xml parser
- vows: test framework

## Installing node.js
The blob service depends on [node.js](http://nodejs.org/). We are working with the v0.6 branch and v0.6.10 tag.  

To match the same branch and tag from github:

    $> git clone -b v0.6 https://github.com/joyent/node.git <target-directory>
    $> cd <target-directory>
    $> git checkout v0.6.10

To build node.js

    ./configure
    make
    make install

## Installing npm
Most node.js applications require modules distributed via npm. Instructions for installing npm can be found at [npmjs.org](http://npmjs.org/).

## Deploying the blob service from source

    $> git clone <project-url> <target-directory>
    $> cd <target-directory>
    $> cp config.json.default config.json
    
now edit `config.json`

## Configuration via config.json
The gateway and its drivers can be configured via config.json which is read at startup. This file is structured as an array of drivers each with a name, type, and options, followed by some global options which include the name of the current driver. It is possible to configure multiple drivers of the same same type in the same file, but only one of these will be activated on startup.

Drivers are assumed to live under `./drivers/<type>` -- currently only `fs` and `s3` driver types are included.  

The FS driver stores all blobs in directories and files under a "root" location in the local file system. The default location if this value is unspecified is `./fs_root`

The S3 driver requires a valid key and secret from your Amazon S3 storage account. All operations are simply passed through the gateway and handled by S3.

NOTE: if no config.json file is found, the gateway will use the settings from `config.json.default`. The following listing shows all currently available config.json options for the FS and S3 drivers.

    {
        "drivers": [
        {
            "<fs-driver-name>": {
                "type": "fs",
                "option": {
                    "root": "<pathname for storing blobs - default is `./fs_root` >",
                    "node_exepath": "<path to node executable - default is `node` >",
                    "collector" : <enable gc and enumeration - default is `true`, NOTE: must be limited to one instance >,
                    "tmp_path" : "<path to a global tmp folder for storing runtime temp files, default is `/tmp` >",
                    "gc_exepath": "<path to gc js file, default is `drivers/fs/fs_gc.js` >",
                    "gc_interval": <ms per gc execution, default is `600,000` (10 min) >,
                    "gcfc_exepath": "<path to lightweight gc js file, default is `drivers/fs/fs_gcfc.js` >",
                    "gcfc_interval": <ms per lightweiht gc execution, default is `1,500` (1.5 sec) >,
                    "gctmp_exepath": "<path to tmp folder gc js file, default is `drivers/fs/fs_gctmp.js` >",
                    "gctmp_interval": <ms per tmp folder gc execution, default is 3,600,000 (1 hr) >,
                    "ec_exepath": "<path to ec js file, default is `drivers/fs/fs_ec.js` >",
                    "ec_interval": <ms per ec execution, default is `1,500` (1.5 sec) >,
                    "quota": <maximum number of bytes allowed to store, default is 100MB >,
                    "obj_limit" : <maximum number of blobs allowed to store, default is 10,000 >
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
        "keyID": "<id for front-end authentication>",
        "secretID": "<secret for front-end authentication>",
        "auth": "<`basic`, `digest` or `s3`; other values mean disabled>",
        "debug": <set to true to enable verbose output of all requests in the console>,
        "account_file" : <pathname for the cloudfoundry binding file, default is "./account.json">,
        "account_api" : <set to true to enable cloudfoundry service apis, default is true>
    }

`current driver` is used to specify the driver to be used by the service at startup. Only 1 driver can be in use at any time. If no default is specified the first driver will be used.

`logfile` specifies the path to the log file. The `logtype` has to be [winston](https://github.com/indexzero/winston).

`keyID` and `secretID` and `auth` are used to control front-end authentication. If either the key or id is not present or if auth is not set to a proper auth type then authentication is disabled. Currently the following types are supported: "basic", "digest", and "s3". "basic" and "digest" implementation follows rfc2617.

`debug` is used to log request and response headers to the console for debugging purposes. Its value is treated as boolean.

`account_file` is the place where vblob instance stores the CloudFoundry service binding credentials. After a vblob service instance is provisioned in CloundFoundry, user can binding multiple CF apps to the instance. This file indicates vblob where to load and update the binding crendentials so that the apps can properly authenticate with the vblob instance. `account_api` controls whether the CF bind/unbind API is on/off in the instance. For a single node deployment, this is always set to true. For a multi-node deployment, only one node should turn on this switch. 

## Usage

    node server.js [-f path_to_config_file]
    
Note that `-f config-path` is optional. The gateway will look for `./config.json` or `./config.json.default`

## Testing
To run the common (non-driver-specific) unit tests, first make sure server.js is configured and running with one of the drivers, then

    cd test
    ../node_modules/vows/bin/vows common_test/test*.js --spec

To run the fs-driver tests from the same test folder do:

    ../node_modules/vows/bin/vows fs_test/test*.js --spec

NOTE: To avoid invoking vows via ../node_modules, install vows globally using `npm install -g vows`  
        
## Manual usage with curl
The following curl commands assume:

- authentication is NOT enabled. 
- the node.js process is running on localhost and listening on port 9981.

### Listing all buckets

    curl http://localhost:9981 -v

### Listing objects in a bucket
  
    curl http://localhost:9981/container1 -v

Four parameters are supported: prefix; delimiter; marker; max-keys. E.g.:

    curl "http://localhost:9981/container1/?prefix=A/&delimiter=/" -v

The above query will list virtual folders in 'container1' starting with 'A/' and using delimiter '/'.

### Create a bucket

    curl http://localhost:9981/container1 -X PUT -v

### Delete a bucket

    curl http://localhost:9981/container1 -X DELETE -v

### Uploading a file

    curl http://localhost:9981/container1/file1.txt -X PUT -T file1.txt -v

User-defined metadata is supported. All user meta keys start with prefix `x-amz-meta-`. E.g.

    curl http://localhost:9981/container1/file1.txt -X PUT -T file1.txt -H "x-amz-meta-comment:hello_world"

### Copying a file

    curl http://localhost:9981/container1/file1.txt -X PUT -H "x-amz-copy-source:/container2/file2.txt"

The above request copy file2.txt in container2 to file1.txt in container1. This operation will copy meta data as well.

### Deleting a file

    curl http://localhost:9981/container1/file1.txt -X DELETE -v

### Reading a file

    curl http://localhost:9981/container1/file1.txt -v

Standard `range` headers are supported for single range reads. E.g.

    curl http://localhost:9981/container1/file1.txt -H "range:bytes=123-892" -v

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

    ./s3curl.pl --id gateway -- -X DELETE -v http://localhost:9981/BucketToDelete

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

    ulimit -n 8192

## File a Bug

To file a bug against Cloud Foundry Open Source and its components, sign up and use our
bug tracking system: [http://cloudfoundry.atlassian.net](http://cloudfoundry.atlassian.net)
