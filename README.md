# vblob-node

 Node blob gateway service.

## Features

  - RESTful web service
  - Plugin model (currently support local fs, s3)
  - streaming in/out blobs
  - basic blob operations: create/delete/get/copy blobs; create/list/delete buckets; query with prefix/delimiter/marker/max-keys; virtual folders
  - user defined meta data
  - S3 compatibility
  - virtualized buckets (automatically mapping buckets to different backends)

## Authors

  - Sonic Wang (wangs@vmware.com)

## Dependency

### Common Modules

  - Express, web framework 
  - Winston, logging module

### Local FS driver:

  - node-mongodb-native: https://github.com/christkv/node-mongodb-native.git (use latest source code, no npm install)
  - A mongo db service with a provisioned user account

#### mongo setup
  - start mongo: `./mongod -f mongodb.config` (in bin folder - adjust to correct config file location - config file points to db location)
  - note port on startup (must match option.mds.port in config.json)
  - start mongo console: `./mongo` in bin folder
  - change database, e.g.: `use test` (must match option.mds.db in fs driver part of config.json)
  - setup user account, e.g.: `db.addUser('user1', 'password1')` (must match option.mds.user and option.mds.pwd)


### Amazon S3 driver:
  - sax-js xml parser: https://github.com/isaacs/sax-js.git
  - Amazon S3 storage account (a valid id/key pair) 

## Configuration

    config.json

The above file contains a stringtified JSON object describing supported driver details.

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
		"default" : "fs",
		"logfile" : "/tmp/log"
	}

Each driver must specify its type. Currently `fs` and `s3` are supported. The `option` value contains the neccessary information a driver needs. For `fs`, the value contains root directory for storing blobs; host/port/db/user/password for mongodb. For `s3`, the values contains a pair of s3 key and secret. `default` means the default driver type. When there are naming conflicts, the driver appears first in the array will be chosen. `logfile` specifies the path to log file.

## Usage

    node server.js [-f path_to_config_file]

Currently supported drivers are `fs` and `s3`. If no default driver is specified in configure file, the first one appears in configuration file will be the default one. Otherwise, the specified one is the default driver. The default driver is currently used to determine in which backend a new bucket should be created. 

After the gateway service starts, gateway will periodically detect buckets in all the backends and create a mapping in memory. A request to a particular bucket will be correctly routed to corresponding backend. Currently any client could send http RESTful requests to the server.

### Listing buckets

    curl http://localhost:3000/ --verbose

### Listing a bucket
  
    curl http://localhost:3000/container1/ --verbose

One could add a query to the URL. Currently four criteria are supported: prefix; delimiter; marker; max-keys. E.g.:

    curl "http://localhost:3000/container1/?prefix=A/&delimiter=/" --verbose

The above query will also list virtual folders in result as well.

### Create a bucket

    curl http://localhost:3000/container1 --request PUT --verbose

### Delete a bucket

    curl http://localhost:3000/container1 --request DELETE --verbose

### Uploading a file

    curl http://localhost:3000/container1/file1.txt --request PUT -T file1.txt --verbose

Currently user-defined meta data is supported. All user meta keys start with prefix `x-amz-meta-`. E.g.:

    curl http://localhost:3000/container1/file1.txt --requst PUT -T file1.txt -H "x-amz-meta-comment:hello_world"

### Copying a file

    curl http://localhost:3000/container1/file1.txt --request PUT -H "x-amz-copy-source:/container2/file2.txt"

The above request will direct gateway to copy file2.txt in container2 to file1.txt in container1. Currently only intra-driver copy is supported. This means both container1 and container2 must be within the same driver(backend). This operation will copy meta data as well. All user-defined meta data in file2.txt will be copied to file1.txt. 

This operation will return code `200`. In addition, the response body includes a JSON format object. It has two fields: `LastModified`, and `ETag`. 

### Deleting a file

    curl http://localhost:3000/container1/file1.txt --request DELETE --verbose

### Reading a file

    curl http://localhost:3000/container1/file1.txt --verbose

Currently additional header `range` is supported for single range read as well. Thus user can issue something like this:

    curl http://localhost:3000/container1/file1.txt -H "range:bytes=123-892" --verbose

## S3 compatibility

There is strong demand for an S3 compatibility. Thus we implement front end APIs to be S3 compatible. This means urls, headers and request bodies are all S3 compatible. At the same time, responses will be S3 compatible as well. This means response headers and bodies are all S3 compatible. 

In order not to make this project a pure S3 emulator effort, we will restrict the compatibility to a subset of all S3 features.

Currently all responses (except blob streams) are of JSON format. This is an intermediate representation. We convert S3 XML format to a JSON equivalent one. We use this as a reference model for other drivers (currently local fs). That is, every driver returns responses in a JSON format that is able to be converted to S3 XML without losing any information.

## Server Tuning

When gateway is handling a great amount of concurrent requests, it may open too many file descriptors. It is suggested to increase the file descriptor limit. E.g.: in linux one may type

    ulimit -n 16384

