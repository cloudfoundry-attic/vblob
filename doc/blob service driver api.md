# Blob Service driver API

## constructor

    driver = createDriver(options, callback)

`createDriver` is a factory method, and the only function exported by each driver module. It returns an interface object with all the heartbeat, bucket, and object operations listed below.

**`options`** is a hash variable that contains credentials for specific drivers.  

The FS driver requires:  

- `root`: the root folder storing all the blobs
- `mds` : a hash contains configuration for mongodb meta service
- `mds.host` : mongodb host ip
- `mds.port` : mongodb port
- `db` : mongodb db name
- `user` : mongodb user account
- `pwd` : password for the above account

The S3 driver requires:

- `key` : s3 account id
- `secret` : secret for the above id

**`callback`** will register periodical events for refreshing bucket-driver mapping.  

## heartbeat

    pingDest (callback)
      
This is workaround for a known node.js bug. When an http request is sent to an unreachable destination, node will raise an uncachable exception which in turn crashes the whole process. Because of this bug, current design will call this API first to detect if destination if reachable. If yes, further http connection will establish within the callback.

## bucket operations

    list_buckets (requ,resp)
      
- `requ` : request from client (app)
- `resp` : response to client (app)
	
In current design this function is not used to return results to client. Instead, it's used by server to periodically get the lists of buckets from each individual driver. The lists of buckets are used for refreshing the bucket-driver mapping for blob virtualization. Currently `requ` is always null. `resp` is not a real response to client, it's just a response mock.
	
    create_bucket (container,resp,requ)  

- `container` : string for bucket name
- `requ` : client request
- `resp` : response to client
	
It's up to the driver to implement the set of operations supported.  
Currently FS driver does not use any information from `requ`. It only creates a bucket.    
S3 driver can support the following:  

- basic bucket creation
- creating a bucket to a given location; this reads an xml configuration file from request body in `requ`
- enabling / disabling logging on the bucket: The `requ` will contain parameter `?logging` in query; 

.
    delete_bucket (container,resp)

- `container` : bucket name
- `resp` : response to client
	
This deletes a bucket. Driver should check if a bucket is empty. If not, driver should return error response. This is suggested for S3 compatibility, not mandatory.
	
    list_bucket (container,option,resp)  

- `container` : bucket name
- `option` : a set of parameters parsed from request query
- `option.marker` : specifying the starting key for listing objects
- `option.prefix` : specifying the prefix of objects that should be listed
- `option.delimiter` : specifying the delimiter of objects that should be listed
- `option.max-keys` : specifying the max number of objcts to be listed in on query
- `option.location` : specifying this is a get location request (S3 driver specific)
- `option.logging` : specifying this is a get logging request (s3 driver specific)
	
It's up to the driver to implement the set of operations supported. 
	
FS driver supports only listing objects (only accepts the first four option parameters listed above).  
S3 driver supports the following operations:  

- listing objects (using the first four params)
- get bucket location see [aws documentation](http://docs.amazonwebservices.com/AmazonS3/latest/API/RESTBucketGETlocation.html)
- get bucket logging [aws documentation](http://docs.amazonwebservices.com/AmazonS3/latest/API/RESTBucketGETlogging.html)

## object operations

    read_file (container,filename,range,verb,resp,requ)

- `container` : bucket name
- `filename` : object key
- `range` : range header
- `verb` : either get or head
- `resp` : request from client
- `requ` : response to client

Either return the whole body of the object, or do a partial read(if range is present).

It's up to the driver to decide the set of headers / parameters to support. Currently both S3 and FS support the following headers:

- `Range`
- `If-Modified-Since` 
- `If-Unmodified-Since`
- `If-Match` 
- `If-None-Match`

In addition, S3 driver supports the response-* parameters.

    create_file (container,filename,requ,resp)

Driver should look at the `requ.headers` for particular header keys. Both S3 and FS drivers support:  

- `x-amz-meta-*` : user-defined metadata
- `Content-Type`
- `Content-MD5` : this is not ETag (hex of md5 hash), it's the base64 encoding of the md5 hash
- `Content-Length`
	
In addition, S3 driver supports:

- `Cache-Control`
- `Content-Disposition`
- `Content-Encoding`
- `Expires`
- `x-amz-storage-class`

.
   copy_file (dest_c,dest_f,src_c,src_f,requ,resp)


*TODO*

    delete_file (container,filename,resp)  

Deletes an object

