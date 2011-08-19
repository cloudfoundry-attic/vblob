# Blob Service Rest API

## Intro
The blob service has been designed to offer a useful subset of the S3 API with maximal compatibility with S3.  This release is intended for applications running in Cloud Foundry. The service cannot be reached directly from the Internet. There are currently 2 providers of storge for the blob service, S3, and a Cloud Foundry local disk or shared file system like NFS. These may be configured as drivers in the blob service by the operator of the service or via an additional service interface not described in this document. This document describes the subset of S3-compatible REST api supported by the blob service for working with objects and buckets. Requests to the blob service are translated into operations on the underlying service via the blob service and the installed driver. 

NOTE: Much of the information in this document is very similar to the respective portions of the S3 API, documented on the [Amazon Web Services website for S3](http://docs.amazonwebservices.com/AmazonS3/latest/API/).

## REST endpoint
Libraries written to work with S3 should be usable as long they can be directed to the blob service endpoint (address:port) as provisioned by Cloud Foundry. This information will be made accessible to applications in Cloud Foundry via their environment. The blob service does not support endpoints with bucket names. Bucket names are always specified in the query path of the URL.

## Request signing
Requests have to be signed using the same method as S3 requests. Keys for signing requests will be provisioned by Cloud Foundry and injected into the environment of Applications just like the service endpoint. For details on signing requests see the [aws developer documentation][1].

[1]: http://docs.amazonwebservices.com/AmazonS3/latest/dev/index.html?RESTAuthentication.html

## Bucket guidlines
Bucket names are restricted in various ways for different back-end service providers. For interoperability, it is recommended to follow [S3 guidelines for bucket names][2]. The blob service does not currently support any bucket configuration options or ACLs on buckets.

[2]: http://docs.amazonwebservices.com/AmazonS3/latest/dev/BucketRestrictions.html


### List buckets
The blob service will list all buckets from all configured drivers together. When multiple buckets exist with the same name the bucket from the first driver in the current driver configuration list will take precendence. Currently this list is maintained dynamically so that new buckets in the underlying storage service created via another gateway or other channels are automatically discovered.

    GET http://<service-endpoint>/

    GET / HTTP/1.1
    Host: localhost:3000
    Date: Thu, 18 Aug 2011 15:38:02 +0000
    Authorization: AWS jleschner:/70rBY2QIhk761qyIizKc9TTOzE=

Sample response *(xml indented for readability)*

    HTTP/1.1 200 OK
    Connection: close
    Content-Type: application/xml
    Date: Thu, 18 Aug 2011 15:38:02 GMT
    Server: blob gw

    <?xml version="1.0" encoding="UTF-8"?>
    <ListAllMyBucketsResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
      <Owner>
        <ID>jleschner</ID>
        <DisplayName>jleschner</DisplayName>
      </Owner>
      <Buckets>
        <Bucket>
          <Name>bucket1</Name>
          <CreationDate>Sat Aug 13 2011 22:30:17 GMT-0400 (EDT)</CreationDate>
        </Bucket>
        <Bucket>
          <Name>bucket2</Name>
          <CreationDate>Sat Aug 13 2011 22:38:10 GMT-0400 (EDT)</CreationDate>
        </Bucket>
      </Buckets>
    </ListAllMyBucketsResult>


### Create bucket

    PUT http://<service-endpoint>/<bucket-name>

This will create a new bucket assuming that it does not already exist in any of the confgured drivers. If multiple drivers are configured, the blob service will create new buckets using the driver configured as the "default". If the bucket already exists in any of the currently configured drivers, the success response is returned. With the S3 driver if the bucket already exists in another S3 account, a failure response is returned (see below)

Generally there is no payload data on bucket PUT requests, however requests with XML payloads for `<CreateBucketConfiguration>...` are passed through to the driver. Currently only the S3 driver passes this back to S3, the FS driver ignores it. For more details see the [aws documentation](http://docs.amazonwebservices.com/AmazonS3/latest/API/RESTBucketPUT.html)
  
Sample response success:

    HTTP/1.1 200 OK
    Connection: close
    date: Thu Aug 18 2011 08:55:47 GMT-0700 (PDT)
    Server: FS
    x-amz-request-id: 1D2E3A4D5B6E7E8F9
    x-amz-id-2: 3F+E1E4B1D5A9E2DB6E5E3F5D8E9
    content-length: 0
    location: /bucket3

Sample response failure from S3: Bucket name not available

    HTTP/1.1 409 Conflict
    x-amz-request-id: 9B66FD00A584C98B
    x-amz-id-2: P2LaCh+MRxGSDvS4x7/vCQ/xtHTzwnHGATYvxAtRYTKJcQi12djDO4v9aFh9rfTI
    content-type: application/xml
    date: Thu, 18 Aug 2011 16:28:48 GMT
    server: AmazonS3
    Connection: close

    <?xml version="1.0" encoding="UTF-8"?>
    <Error>
      <Code>BucketAlreadyExists</Code>
      <Message>The requested bucket name is not available. The bucket namespace is shared by all users of the system. Please select a different name and try again.</Message>
      <BucketName>www.photal.com</BucketName>
      <RequestId>9B66FD00A584C98B</RequestId>
      <HostId>P2LaCh+MRxGSDvS4x7/vCQ/xtHTzwnHGATYvxAtRYTKJcQi12djDO4v9aFh9rfTI</HostId>
    </Error>


### Delete bucket

    DELETE http://<service-endpoint>/<bucket-name>

Sample response (success)

    HTTP/1.1 204 No Content
    Connection: close
    date: Thu Aug 18 2011 09:11:07 GMT-0700 (PDT)
    Server: FS
    x-amz-request-id: 1D2E3A4D5B6E7E8F9
    x-amz-id-2: 3F+E1E4B1D5A9E2DB6E5E3F5D8E9

Sample response: failure, bucket not found - *XML indented for readability*

    HTTP/1.1 404 Not Found
    Connection: close
    Content-Type: application/xml
    Date: Thu, 18 Aug 2011 16:16:04 GMT
    Server: blob gw

    <?xml version="1.0" encoding="UTF-8"?>
    <Error>
      <Code>BucketNotFound</Code>
      <Message>No Such Bucket</Message>
    </Error>


### Listing keys of objects in one bucket
Buckets may contain many objects. Enumerating the objects in a Bucket returns an alphabetically sorted list of keys and additional metadata about each item.

    GET http://<service-endpoint>/<bucket-name>
    
Sample response

    HTTP/1.1 200 OK
    X-Powered-By: Express
    Connection: close
    content-type: application/xml
    date: Thu Aug 18 2011 10:36:58 GMT-0700 (PDT)
    Server: FS
    x-amz-request-id: 1D2E3A4D5B6E7E8F9
    x-amz-id-2: 3F+E1E4B1D5A9E2DB6E5E3F5D8E9
    Transfer-Encoding: chunked
    
    <?xml version="1.0" encoding="UTF-8"?>
    <ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/">
      <Name>bucket1</Name>
      <Prefix/>
      <Marker/>
      <MaxKeys>1000</MaxKeys>
      <IsTruncated>false</IsTruncated>
      <Contents>
        <Key>file1.xml</Key>
        <LastModified>Thu Aug 18 2011 10:28:54 GMT-0700 (PDT)</LastModified>
        <ETag>"9fff58b7a9575dea85e7ca6ddbe31125"</ETag>
        <Size>60421</Size>
        <Owner/>
        <StorageClass>STANDARD</StorageClass>
      </Contents>
      <Contents>
        <Key>file2.xml</Key>
        <LastModified>Thu Aug 18 2011 10:35:57 GMT-0700 (PDT)</LastModified>
        <ETag>"9fff58b7a9575dea85e7ca6ddbe31125"</ETag>
        <Size>60421</Size>
        <Owner/>
        <StorageClass>STANDARD</StorageClass>
      </Contents>
    </ListBucketResult>

When there are more than 1000 objects, multiple requests need to be made, each returning up to 1000 keys. Requests are parameterized with:
- `marker`: item after which to start enumerating
- `maxkeys`: request for no more than this number of items 
  
For simulating hierarchies of items, the following parameters are supported
- `prefix`: restricts results to keys matching the prefix string 
- `delimiter`: (typically '/'), returns a deduplicated list of substrings in keys satisfying both prefix and delimiter (in addition to keys with just prefix)

for more details see the [S3 documentation on enumerating](http://docs.amazonwebservices.com/AmazonS3/latest/dev/ListingKeysUsingAPIs.html).

## Object operations
Objects are identified by keys which are specified in the request after the bucket name.
- Creation dates are sizes are automatically maintained by the system.
- Additional metadata can be stored with each object using extra headers.

### Read Object
Objects can be read by a client via the GET method

    GET http://<service-endpoint>/<bucket-name>/<object-key>

Sample exchange

    $ ./s3curl.pl --id localtest -- -v http://localhost:3000/bucket1/foo.txt

    > GET /bucket1/foo.txt HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Thu, 18 Aug 2011 17:42:40 +0000
    > Authorization: AWS jleschner:m/jcNUupkajVuffsWItil0VFbII=

    < HTTP/1.1 200 OK
    < X-Powered-By: Express
    < Connection: close
    < content-type: binary/octet-stream
    < date: Thu Aug 18 2011 10:42:40 GMT-0700 (PDT)
    < Server: FS
    < x-amz-request-id: 1D2E3A4D5B6E7E8F9
    < x-amz-id-2: 3F+E1E4B1D5A9E2DB6E5E3F5D8E9
    < Content-Length: 12
    < Last-Modified: Thu Aug 18 2011 10:41:53 GMT-0700 (PDT)
    < ETag: 6f5902ac237024bdd0c176cb93063dc4
    < Accept-Ranges: bytes

    hello world


For partial reads, standard HTTP range headers are supported. 
Additional headers are supported for retrieving objects e.g. to specify ETag (hash) or If-Modified-Since conditions.


### Create or Replace or Copy object
Objects are created, replaced, or copied with a PUT request

    PUT http://<service-endpoint>/<bucket-name>/<object-key>

Sample exchange

    $ ./s3curl.pl --id localtest -- -X PUT -T 1.xml -v http://localhost:3000/bucket1/file1.xml

    > PUT /bucket1/file1.xml HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Thu, 18 Aug 2011 17:28:54 +0000
    > Authorization: AWS jleschner:DxxIqXEM2iLzOqLG9OSZfSlEBRs=
    > Content-Length: 60421
    > Expect: 100-continue

    < HTTP/1.1 100 Continue
    < HTTP/1.1 200 OK
    < X-Powered-By: Express
    < Connection: close
    < date: Thu Aug 18 2011 10:28:54 GMT-0700 (PDT)
    < Server: FS
    < x-amz-request-id: 1D2E3A4D5B6E7E8F9
    < x-amz-id-2: 3F+E1E4B1D5A9E2DB6E5E3F5D8E9
    < ETag: 9fff58b7a9575dea85e7ca6ddbe31125
    < content-length: 0


If the object-key already exists, the service will replace the existing object with the new one. Using a special header `x-amz-copy-source` allows the PUT to make a copy of an existing object, with a different key say or different metadata, or in a different bucket, without re-submitting the actual blob.

PUT operations are all-or-nothing. There is currently no support for partial writes, or resumable writes. Concurrent PUTs with the same key result in a single winner. Currently there is no versioning support for catching multiple objects created with the same key.

### Delete object

    DELETE http://<service-endpoint>/<bucket-name>/<object-key>

Sample exchange (successful)

    $ ./s3curl.pl --id localtest -- -X DELETE -v http://localhost:3000/bucket1/foo.txt

    > DELETE /bucket1/foo.txt HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Thu, 18 Aug 2011 19:32:21 +0000
    > Authorization: AWS jleschner:xjno3GAuIpARe1vBKbCrTJnNU1M=

    < HTTP/1.1 204 No Content
    < X-Powered-By: Express
    < Connection: close
    < date: Thu Aug 18 2011 12:32:21 GMT-0700 (PDT)
    < Server: FS
    < x-amz-request-id: 1D2E3A4D5B6E7E8F9
    < x-amz-id-2: 3F+E1E4B1D5A9E2DB6E5E3F5D8E9

Sample response (error)

    HTTP/1.1 404 Not Found
    X-Powered-By: Express
    Connection: close
    content-type: application/xml
    date: Thu Aug 18 2011 12:33:53 GMT-0700 (PDT)
    Server: FS
    x-amz-request-id: 1D2E3A4D5B6E7E8F9
    x-amz-id-2: 3F+E1E4B1D5A9E2DB6E5E3F5D8E9
    content-length: 108

    <?xml version="1.0" encoding="UTF-8"?>
    <Error>
      <Code>NoSuchFile</Code>
      <Message>No such file</Message>
    </Error>
