# Blob Service Rest API
This document describes the REST api supported by the Blob service for accessing objects and buckets from Cloud Foundry applications. Please refer to the project [README](../README.md) if you are looking for instructions on how to deploy and use the Blob service as a standalone process without using the Cloud Foundry infrastructure.

## Introduction
The Blob service has been designed to offer a useful subset of the S3 API with maximal compatibility with S3.  This release is intended for applications running inside a Cloud Foundry environment like cloudfoundry.com or Micro Cloud Foundry. The service cannot currently be reached directly from the Internet.

There are currently 2 providers of storage for the Blob service: S3 or file system. These may be configured as drivers in the Blob service by the operator of the service or via an additional service interface not described in this document.  Requests to the Blob service are translated into operations on the underlying service via the Blob service and the installed driver.

NOTE: Much of the information in this document is very similar to the respective portions of the S3 API, documented on the [Amazon Web Services website for S3](http://docs.amazonwebservices.com/AmazonS3/latest/API/).

#### Supported S3 features
The following core features of the S3 API are supported. More details and examples are provided below.

- REST api addressing using `http://{endpoint}/{bucket-name}/{object-key}` syntax
- bucket operations (create, delete, list)
- object operations (create using PUT, GET, GET range, HEAD, replace using PUT, DELETE, copy using PUT, list using GET on bucket)
- metadata (timestamps, etags, predefined headers, user-defined headers)
- conditional operations (based on etag or date)

#### Unsupported S3 features
The following S3 API features are currently unsupported

- virtual-host style buckets using `http://{bucket-name}.{endpoint}/{object-key}` syntax
- https
- multiple cloud-foundry locations in a single instance of the FS driver
- multiple amazon aws locations with a single instance of the S3 driver
- POST requests to upload objects
- ACLs on objects or ACL policies on buckets
- logging or notifications
- object versions
- multi-part uploads
- requestor-pays buckets
- "website" bucket configuration (default and error docs)
- torrent api
- SOAP api


#### REST endpoint and bucket names
Libraries written to work with S3 should be usable as long they can be directed to the Blob service endpoint (host:port) as provisioned by Cloud Foundry. This information will be made accessible to applications in Cloud Foundry via their environment. The Blob service does not support "virtual host" style endpoints with bucket names in the `Host` header. Bucket names are always specified in the query path of the URL. E.g.

    http://<service-endpoint>/<bucket-name>/...

#### Request signing
Requests have to be signed using the same method as S3 requests. Keys for signing requests will be provisioned by Cloud Foundry and injected into the environment of Applications just like the service endpoint. For details on signing requests see the [aws developer documentation][1].

[1]: http://docs.amazonwebservices.com/AmazonS3/latest/dev/index.html?RESTAuthentication.html

#### Bucket naming guidelines
For interoperability, the Blob service restricts Bucket names following the DNS-compatible recommendations in the [S3 guidelines for bucket names][2]. In short:

1. no capital letters (to be able to use virtual host)
2. starting with lower case letters or numbers
3. 3 ~ 63 chars
4. no "_"
5. no "/"
6. no ".."
7. no "-." or ".-"
8. no IP address

> **(REVIEW?)** also disallow "-" at end

[2]: http://docs.amazonwebservices.com/AmazonS3/latest/dev/BucketRestrictions.html

## Working with buckets

### List buckets

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

This will create a new bucket assuming that it does not already exist in any of the confgured drivers. If multiple drivers are configured, the Blob service will create new buckets using the driver configured as the "default". If the bucket already exists in any of the currently configured drivers, the success response is returned. With the S3 driver if the bucket already exists in another S3 account, a failure response is returned (see below)

Generally there is no payload data on bucket PUT requests, however requests with XML payloads for `<CreateBucketConfiguration>...` are passed through to the driver. Currently only the S3 driver passes this back to S3, the FS driver ignores it. For more details see the [aws documentation](http://docs.amazonwebservices.com/AmazonS3/latest/API/RESTBucketPUT.html)
  
NOTE that other request headers, in particuler `x-amz-acl` are not passed through the way XML payloads are.

> **(REVIEW?)** this appears inconsistent for two reasons  
> a) why should x-amx-acls be different from location constraints in the XML bucket config? 
> b) why allow location constraints if there is no way to handle the 307 redirects when buckets are created in non-default locations? 
  
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

Sample response: failure, no such bucket - *XML indented for readability*

    HTTP/1.1 404 Not Found
    Connection: close
    Content-Type: application/xml
    Date: Thu, 18 Aug 2011 16:16:04 GMT
    Server: blob gw

    <?xml version="1.0" encoding="UTF-8"?>
    <Error>
      <Code>NoSuchBucket</Code>
      <Message>The specified bucket does not exist</Message>
      <BucketName>jltest6</BucketName>
      <RequestId>40DF6D9131B0F8F9</RequestId>
      <HostId>luisdxWwZiBt7grFTbDFFIqlVYuxoggdLI5tDQ+l0qqhR4uaA6I5+nTJ2dnlCzf0</HostId>
    </Error>

Sample no such bucket response from FS driver

    <?xml version="1.0" encoding="UTF-8"?>
    <Error>
      <Code>NoSuchBucket</Code>
      <Message>No such bucket on disk</Message>
    </Error>

> **(REVIEW?)** appears a little inconsistent


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

### Unsupported bucket operations
The following request parameters are not currently supported by the Blob service. In S3, these are specified as special parameters after the ? in the URL for REST requests and most of the operations use an XML document for both GET and PUT. The exception on S3 is ?policy documents which are transmitted as JSON. 

The current implementation of the Blob service, ignores these parameters and treats requests which have these parameters as bucket list or bucket creation requests.

> **(REVIEW?)** maybe better to return explicit "not supported" errors instead of interpreting as valid requests.

- `?acl`
- `?policy`
- `?location`
- `?logging`
- `?notification`
- `?requestPayment`
- `?uploads`
- `?versioning`
- `?versions`
- `?website`

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

    1234567890

For partial reads, standard HTTP range headers are supported. E.g.

    $ ./s3curl.pl --id localtest -- -v -H "Range: bytes=0-3" http://localhost:3000/bucket1/foo.txt

    > GET /bucket1/foo.txt HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Mon, 12 Sep 2011 15:19:35 +0000
    > Authorization: AWS jleschner:hrspG1TMaWtyZjbdlkCJj8rJL9M=
    > Range: bytes=0-3

    < HTTP/1.1 206 Partial Content
    < X-Powered-By: Express
    < Connection: close
    < content-type: binary/octet-stream
    < date: Mon Sep 12 2011 11:19:35 GMT-0400 (EDT)
    < Server: FS
    < x-amz-request-id: 1D2E3A4D5B6E7E8F9
    < x-amz-id-2: 3F+E1E4B1D5A9E2DB6E5E3F5D8E9
    < Content-Length: 4
    < Last-Modified: Mon Sep 12 2011 11:17:51 GMT-0400 (EDT)
    < ETag: 7c12772809c1c0c3deda6103b10fdfa0
    < Accept-Ranges: bytes
    < Content-Range: bytes 0-3/11

    1234


Additional headers are supported for retrieving objects e.g. to specify If-Match on ETag or If-Modified-Since conditions. E.g.

    $ ./s3curl.pl --id localtest -- -H "If-Match:bogus-etag" http://localhost:3000/bucket1/foo.txt

    <?xml version="1.0" encoding="UTF-8"?>
    <Error>
      <Code>PreconditionFailed</Code>
      <Message>At least one of the preconditions you specified did not hold.</Message>
    </Error>

and

    $ ./s3curl.pl --id localtest -- -H "If-Modified-Since:Mon Sep 12 2011 11:17:50 GMT-0400 (EDT)" http://localhost:3000/bucket1/foo.txt
    1234567890

but

    $ ./s3curl.pl --id localtest -- -v -H "If-Modified-Since:Mon Sep 12 2011 11:17:51 GMT-0400 (EDT)" http://localhost:3000/bucket1/foo.txt

    > GET /bucket1/foo.txt HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Mon, 12 Sep 2011 15:31:03 +0000
    > Authorization: AWS jleschner:rKacAr+fyx2ZLryFcu3udbsafn0=
    > If-Modified-Since:Mon Sep 12 2011 11:17:51 GMT-0400 (EDT)

    < HTTP/1.1 304 Not Modified
    < X-Powered-By: Express
    < Connection: close
    < content-type: application/xml
    < date: Mon Sep 12 2011 11:31:03 GMT-0400 (EDT)
    < Server: FS
    < x-amz-request-id: 1D2E3A4D5B6E7E8F9
    < x-amz-id-2: 3F+E1E4B1D5A9E2DB6E5E3F5D8E9


### Create or Replace or Copy object
Objects are created, replaced, or copied with a PUT request

    PUT http://<service-endpoint>/<bucket-name>/<object-key>

Sample exchange

    $ ./s3curl.pl --id localtest -- -v -X PUT -T foo.txt http://localhost:3000/bucket1/foo.txt

    > PUT /bucket1/foo.txt HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Mon, 12 Sep 2011 15:17:51 +0000
    > Authorization: AWS jleschner:M/CW8hMXjdpzcn8zpz5GCgzhD/I=
    > Content-Length: 11
    > Expect: 100-continue

    < HTTP/1.1 100 Continue
    < HTTP/1.1 200 OK
    < X-Powered-By: Express
    < Connection: close
    < date: Mon Sep 12 2011 11:17:51 GMT-0400 (EDT)
    < Server: FS
    < x-amz-request-id: 1D2E3A4D5B6E7E8F9
    < x-amz-id-2: 3F+E1E4B1D5A9E2DB6E5E3F5D8E9
    < ETag: 7c12772809c1c0c3deda6103b10fdfa0
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


## Unsupported Object operations

The Blob service does not currently support any POST operations. These will be provided when the service is extended to support direct access via signed URLs from the public Internet. For more details see [aws POST doc](http://docs.amazonwebservices.com/AmazonS3/latest/API/index.html?RESTObjectPOST.html)

In addition, the following GET, HEAD, and PUT request parameters are not currently supported by the Blob service.

- `?acl` -- see [aws acl doc](http://docs.amazonwebservices.com/AmazonS3/latest/API/index.html?RESTObjectPUTacl.html)
- `?versionID` -- see [aws versioning doc](http://docs.amazonwebservices.com/AmazonS3/latest/dev/index.html?Versioning.html)
- `?torrent` -- see [aws torrent doc](http://docs.amazonwebservices.com/AmazonS3/latest/API/index.html?RESTObjectGETtorrent.html)
- `?uploads`, `&PartNumber` and `&UploadID` -- see [aws multi-part uploads doc](http://docs.amazonwebservices.com/AmazonS3/latest/API/index.html?mpUploadInitiate.html)
