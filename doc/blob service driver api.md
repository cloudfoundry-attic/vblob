# Blob Service driver API

Copyright (c) 2011-2012 VMware, Inc.

## constructor

    driver = createDriver(options, callback)

`createDriver` is a factory method, and the only function exported by each driver module. The function returns an instance of a driver interface configured with the specified connection options. The Blob service is currently configured to call this method for s3 and FS type drivers upon startup.

`options` is a hash variable that contains credentials for specific drivers. These corresponds to the `options` specified in config.json for each driver.

In addition, all drivers receive:

- `options.logger`: a logger object on which to call error(), debug(), info(), and warn() with a message string for logging purposes.

The FS driver receives:  

- `options.root`: the root folder storing all the blobs

The S3 driver receives:

- `options.key` : s3 account id
- `options.secret` : secret for the above id

createDriver() returns the driver object immediately, but internally it may still be waiting to finish initializing itself. The driver should also return itself in callback(driver) when it is done initializing.

## General request/response flow 

The driver api supports passage of request and response information between the client and the back-end service via an `options` object passed into the driver on some methods (see specific methods below), and via a `response_header` object on the return. Note that the names of headers are passed to and from driver methods as lower-cased JSON keys.

Inbound streams are passed to the driver as a stream object on which the driver can register `data` and `end` event handlers or connect via a `pipe()`. Similarly, outbound streams are returned by the driver as a `response_data` stream which the gateway can `pipe()` back to the client.

Each interface method includes a callback allowing requests to be processed by the driver asynchronously. The callback has the following signature:

    callback (response_code, response_header, response_body, response_data)

- `reponse_code` : HTTP response code
- `response_header` : array of HTTP headers
- `response_body` : response object for non-streaming responses -- will be converted to XML by the gateway
- `response_data` : null except for responses which stream back data -- must be an object that supports pipe()

In order to return s3-compatible XML, the JSON object returned in `response_body` must match the s3 XML response schema for the respective operation i.e all keys are mapped directly to element names in XML.

## errors

Drivers should return errors via the callback (not via throw) as follows.

    callback (http-response-code, null, {"Error": { "Code": error-code, "Message": error-message }});


## bucket operations

### bucket list

    container_list (callback)

Enumerates all buckets owned by the client.

The response body is a javascript object with the following structure: Note that there may be multiple objects in the Bucket array, and CreationDate values follow the ISO convention for XML date strings.

    { ListAllMyBucketsResult: { Buckets: { Bucket: [ {Name: "Bucket1", CreationDate: "2011-10-01T01:20:36.000Z"}, ... ] }}}

The javascript object is converted to XML by the gateway before being sent back to the client.
Note that the gateway may insert Owner information if it has any.

    <?xml version="1.0" encoding="UTF-8"?>
    <ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
      <Owner>
        <ID>..</ID>
        <DisplayName>...</DisplayName>
      </Owner>
      <Buckets>
        <Bucket>
          <Name>Bucket1</Name>
          <CreationDate>2011-10-01T01:20:36.000Z</CreationDate>
        </Bucket>
        <Bucket>
          <Name>Bucket2</Name>
          <CreationDate>2011-10-01T01:20:37.000Z</CreationDate>
        </Bucket>
        ...
      </Buckets>
    </ListAllMyBucketsResult>

### bucket create

    container_create (bucket_name, options, data_stream, callback)  

Creates a new bucket.

- `options` are parameters parsed from the request such as `x-amz-acl` -- this parameter is currently ignored by both drivers.
- `data_stream` is an optional payload for this like `BucketConfiguration` -- this parameter is also currently ignored by both drivers.
- If the bucket already exists for the same account, the response is the same as a successfull creation (return 200).
- The request may be rejected on s3 if the bucket name is already taken by another user -- returns 409 and error code `BucketAlreadyExists`
- If the maximum number buckets is reached, return 400 and an error code `TooManyBuckets`. The default limit in S3 and the FS driver is 100 buckets per account.
- If the bucket name is invalid, return 400 and an error code `InvalidBucketName`.

### bucket delete

    container_delete (bucket_name, callback)

Driver should check if a bucket is empty. If not, driver should return 409 with error code `BucketNotEmpty` 

### bucket options

    container_options (bucket_name, options, callback)  

Currently not implemented in any drivers, but intended to retrieve options and policies such as `location` and `logging` or ACLs.

## object operations

### object list

    file_list (bucket_name, options, callback)  

Returns a list of object keys in a bucket. 
This operation is only supported by the S3 driver currently.

`options` are query parameters parsed from request query

- `options.marker` : specifying the starting key for listing objects
- `options.prefix` : specifying the prefix of objects that should be listed
- `options.delimiter` : specifying the delimiter of objects that should be listed
- `options.max-keys` : specifying the max number of objcts to be listed in on query

The result returned in the response_body of the callback is a JSON object with the following structure. Note that `Contents` array can contain a variable number of objects.

    {
    "ListBucketResult": {
      "Name": "Bucket1",
      "Prefix": {},
      "Marker": {},
      "MaxKeys": "1000",
      "IsTruncated": "false",
      "Contents": [
      {
        "Key": "object_key1",
        "LastModified": "2011-07-27T17:29:23.000Z",
        "ETag": "\"0c0e7e404e17edd568853997813f9354\"",
        "Size": "47392",
        "Owner": {
          "ID": "03b14d14cb23421fe7400e872df6fd8969efbb32f4584207fa5e5cf5ae580ca8",
          "DisplayName": "someone"
        },
        "StorageClass": "STANDARD"
      },
      {
        "Key": "object_key2",
        "LastModified": "2011-07-27T21:16:00.000Z",
        "ETag": "\"d1919d0a02a24aa16412301e9e9dfbe4\"",
        "Size": "58144",
        "Owner": {
          "ID": "03b14d14cb23421fe7400e872df6fd8969efbb32f4584207fa5e5cf5ae580ca8",
          "DisplayName": "someone"
        },
        "StorageClass": "STANDARD"
      },
      ...
    ]}}

This response is the translated by the server into XML.

    <?xml version  ="1.0" encoding="UTF-8"?>
    <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
      <Name>Bucket1</Name>
      <Prefix/>
      <Marker/>
      <MaxKeys>1000</MaxKeys>
      <IsTruncated>false</IsTruncated>
      <Contents>
        <Key>object_key1</Key>
        <LastModified>2011-07-27T17:29:23.000Z</LastModified>
        <ETag>"0c0e7e404e17edd568853997813f9354"</ETag>
        <Size>47392</Size>
        <Owner>
          <ID>03b14d14cb23421fe7400e872df6fd8969efbb32f4584207fa5e5cf5ae580ca8</ID>
          <DisplayName>someone</DisplayName>
        </Owner>
        <StorageClass>STANDARD</StorageClass>
      </Contents>
      <Contents>
        <Key>object_key2</Key>
        <LastModified>2011-07-27T21:16:00.000Z</LastModified>
        <ETag>"d1919d0a02a24aa16412301e9e9dfbe4"</ETag>
        <Size>58144</Size>
        <Owner>
          <ID>03b14d14cb23421fe7400e872df6fd8969efbb32f4584207fa5e5cf5ae580ca8</ID>
          <DisplayName>someone</DisplayName>
        </Owner>
        <StorageClass>STANDARD</StorageClass>
      </Contents>
      ...
    </ListBucketResult>

### object read

Returns an object or part of an object, streamed back via `callback` through `response_data`.
If options

    file_read (bucket_name, object_key, options, callback)

`options` are parameters parsed from the request (mostly headers)

- `options.range` : range header
- `options.head` : get only the headers

The following options cause the request to behave conditionally based on the modification date or ETag (MD5 hash).

- `options.if-modified-since` 
- `options.if-unmodified-since`
- `options.if-match` 
- `options.if-none-match`

The following options are used to override response headers. The driver should return them verbatim in the `response_headers` parameter of the callback, and, if appropriate, also pass them on to the underlying storage service (like s3) so that they can have the desired effect in any HTTP proxy/cache intermediaries. 

- `options.response-content-type`
- `options.response-content-language`
- `options.response-expires`
- `options.response-cache-control`
- `options.response-content-disposition`
- `options.response-content-encoding`


### object create

Creates or replaces an object with a particular object_key. If multiple concurrent requests occur, the last request to finish will win.

    file_create (bucket_name, object_key, options, metadata, data_stream, callback)

`options` are parameters parsed from the request (mostly headers) 

- `options.content-md5` : this is the base64 encoding of the md5 hash (unlike ETag which is in hex). If this is present the creation of the object will be conditional the value of this option matching the md5 hash of the incoming data stream.

`metadata` are additional names/values stored together with the blob and returned as headers in an file_read request

- `metadata.x-amz-meta-*` : user-defined metadata
- `metadata.content-type`
- `metadata.content-length` : this header is required
- `metadata.cache-control`
- `metadata.content-disposition`
- `metadata.content-encoding`
- `metadata.expires`


### object copy

Copies an object to another object with a different key, OR replaces the metadata on an object. This operation does not have an input stream.

    file_copy (bucket_name, object_key, source_bucket_name, source_object_key, options, metadata, callback)

`source_bucket_name` and `source_object_key` specify the source, which may be the same as the `bucket_name` and `object_key`

`options.x-amz-metadata-directive` is optional and has either value `COPY` or `REPLACE`. When copying an object to itself, the value must be `REPLACE`, which causes existing metadata stored with the object to be replaced with new metadata from `metadata`. If the value is `COPY` metadata is copied from the existing object instead of coming from the request.

The following options cause the request to behave conditionally based on the modification date or ETag (MD5 hash) just like the corresponding headers on file_create.

- `options.x-amz-copy-source-if-modified-since` 
- `options.x-amz-copy-source-if-unmodified-since`
- `options.x-amz-copy-source-if-match` 
- `options.x-amz-copy-source-if-none-match`


### object delete

    file_delete (bucket_name, object_key, callback)  

Deletes an object

### get configuration

   get_config ( )

Driver constructs the current configuration into a JSON object and return it. It must follow the following pattern:
  
  {
    "type" : <type of this driver, fs or s3 or whatever>,
    "option" : { <key value pairs> }
  }
