# Blob Service REST API

Copyright (c) 2011 VMware, Inc.

This document describes the REST api supported by the [Blob service] for accessing files and containers from Cloud Foundry applications. Please refer to the project readme.md if you are looking for instructions on how to deploy and use the Blob service as a standalone process without using the Cloud Foundry infrastructure.

## Introduction
This release is intended for applications running inside a Cloud Foundry environment like cloudfoundry.com or Micro Cloud Foundry. The service cannot currently be reached directly from the Internet.

There is currently 1 provider of storage for the Blob service: file system. These are configured as drivers in the Blob service. Only one of the drivers can currently be active in a single deployed instance of the service. Requests to the Blob service are translated into operations on the underlying storage via the installed driver.

#### Request Authentication
Requests have to be authenticated using basic or digest http access authentication. Keys for signing requests will be provisioned by Cloud Foundry and injected into the environment of Applications just like the service endpoint. For authentication implementation, please refer to RFC2617.

#### REST endpoint and container names

    http://<service-endpoint>/<container-name>/...

The Blob service does *not* enforce uniqueness of container names across users. Since each Cloud Foundry user can deploy and bind to their own instance of the Blob service, this restriction is not necessary, even when the service is enhanced to support "virtual host" style endpoints.

For interoperability, the Blob service restricts container names as follows:

- no capital letters
- starting with lower case letters or numbers
- 3 ~ 63 chars
- no "_"
- no "/"
- no ".."
- no "\-." or ".-"
- no IP address
- no "-" at end

## Working with containers

### List containers

    GET / HTTP/1.1
    Host: localhost:3000
    Date: Thu, 18 Aug 2011 15:38:02 +0000
    Authorization: <Basic or Digest>

Sample response _(xml indented for readability)_

    HTTP/1.1 200 OK
    Connection: close
    Content-Type: application/xml
    Date: Thu, 18 Aug 2011 15:38:02 GMT
    Server: blob gw

    <?xml version="1.0" encoding="UTF-8"?>
    <ContainerList xmlns="https://github.com/vmware-bdc/vblob/">
      <Containers>
        <Container>
          <Name>Container1</Name>
          <CreationDate>2011-10-01T01:20:36.000Z</CreationDate>
        </Container>
        <Container>
          <Name>Container2</Name>
          <CreationDate>2011-10-01T01:20:37.000Z</CreationDate>
        </Container>
      </Containers>
    </ContainerList>


### Create container

    PUT http://<service-endpoint>/<container-name>

This will create a new container assuming that it does not already exist. If the container already exists for the current user, success is returned (the request is idempotent).

Sample response success:

    HTTP/1.1 200 OK
    Connection: close
    date: Thu Aug 18 2011 08:55:47 GMT-0700 (PDT)
    Server: FS
    content-length: 0
    location: /container3

### Delete container

    DELETE http://<service-endpoint>/<container-name>

Sample response (success)

    HTTP/1.1 204 No Content
    Connection: close
    date: Thu Aug 18 2011 09:11:07 GMT-0700 (PDT)
    Server: FS

Sample no such container response from FS driver

    <?xml version="1.0" encoding="UTF-8"?>
    <Error>
      <Code>NoSuchContainer</Code>
      <Message>No such container on disk</Message>
    </Error>


### Listing keys of files in one container
Containers may contain many files. Enumerating the files in a Container returns an alphabetically sorted list of keys and additional metadata about each item.

    GET http://<service-endpoint>/<container-name>

Sample response

    HTTP/1.1 200 OK
    X-Powered-By: Express
    Connection: close
    content-type: application/xml
    date: Thu Aug 18 2011 10:36:58 GMT-0700 (PDT)
    Server: FS
    Transfer-Encoding: chunked

    <?xml version="1.0" encoding="UTF-8"?>
    <FileList xmlns="https://github.com/vmware-bdc/vblob/">
      <Name>container1</Name>
      <Prefix/>
      <Marker/>
      <MaxKeys>1000</MaxKeys>
      <IsTruncated>false</IsTruncated>
      <Contents>
        <Key>file1.xml</Key>
        <LastModified>Thu Aug 18 2011 10:28:54 GMT-0700 (PDT)</LastModified>
        <ETag>"9fff58b7a9575dea85e7ca6ddbe31125"</ETag>
        <Size>60421</Size>
        <StorageClass>STANDARD</StorageClass>
      </Contents>
      <Contents>
        <Key>file2.xml</Key>
        <LastModified>Thu Aug 18 2011 10:35:57 GMT-0700 (PDT)</LastModified>
        <ETag>"9fff58b7a9575dea85e7ca6ddbe31125"</ETag>
        <Size>60421</Size>
        <StorageClass>STANDARD</StorageClass>
      </Contents>
    </FileList>

When there are more than 1000 files, multiple requests need to be made, each returning up to 1000 keys. Requests are parameterized with:

- `marker`: item after which to start enumerating
- `maxkeys`: request for no more than this number of items 
  
For simulating hierarchies of items, the following parameters are supported

- `prefix`: restricts results to keys matching the prefix string 
- `delimiter`: (typically '/'), returns a deduplicated list of substrings in keys satisfying both prefix and delimiter (in addition to keys with just prefix)

## File operations

Files are identified by keys which are specified in the request after the container name.

- Creation dates are sizes are automatically maintained by the system.
- Additional metadata can be stored with each file using extra headers.

### Read File

Files can be read by a client via the GET method

    GET http://<service-endpoint>/<container-name>/<file-key>

Sample exchange

    curl -v http://localhost:3000/container1/foo.txt

    > GET /container1/foo.txt HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Thu, 18 Aug 2011 17:42:40 +0000

    < HTTP/1.1 200 OK
    < X-Powered-By: Express
    < Connection: close
    < content-type: binary/octet-stream
    < date: Thu Aug 18 2011 10:42:40 GMT-0700 (PDT)
    < Server: FS
    < Content-Length: 12
    < Last-Modified: Thu Aug 18 2011 10:41:53 GMT-0700 (PDT)
    < ETag: 6f5902ac237024bdd0c176cb93063dc4
    < Accept-Ranges: bytes

    1234567890

For partial reads, standard HTTP range headers are supported. E.g.

    curl -v -H "Range: bytes=0-3" http://localhost:3000/container1/foo.txt

    > GET /container1/foo.txt HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Mon, 12 Sep 2011 15:19:35 +0000
    > Range: bytes=0-3

    < HTTP/1.1 206 Partial Content
    < X-Powered-By: Express
    < Connection: close
    < content-type: binary/octet-stream
    < date: Mon Sep 12 2011 11:19:35 GMT-0400 (EDT)
    < Server: FS
    < Content-Length: 4
    < Last-Modified: Mon Sep 12 2011 11:17:51 GMT-0400 (EDT)
    < ETag: 7c12772809c1c0c3deda6103b10fdfa0
    < Accept-Ranges: bytes
    < Content-Range: bytes 0-3/11

    1234

##### Conditional GET
The following HTTP headers are supported for retrieving files conditionally:

- `if-modified-since` : will validate that the modification date of the file is more recent than the specified date
- `if-unmodified-since` : will validate that the modification date of the file is older 
- `if-match` : will validate that the file's ETag matches the specified value
- `if-none-match` : will validate that the file's ETag value does NOT match

E.g.

    curl -H "If-Match:bogus-etag" http://localhost:3000/container1/foo.txt

    <?xml version="1.0" encoding="UTF-8"?>
    <Error>
      <Code>PreconditionFailed</Code>
      <Message>At least one of the preconditions you specified did not hold.</Message>
    </Error>

and

    curl -H "If-None-Match:7c12772809c1c0c3deda6103b10fdfa0" -v http://localhost:3000/container1/foo.txt

    > GET /container1/foo.txt HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Mon, 12 Sep 2011 17:48:26 +0000
    > If-None-Match:7c12772809c1c0c3deda6103b10fdfa0

    < HTTP/1.1 304 Not Modified
    < X-Powered-By: Express
    < Connection: close
    < content-type: application/xml
    < date: Mon Sep 12 2011 13:48:26 GMT-0400 (EDT)
    < Server: FS

and

    curl -H "If-Modified-Since:Mon Sep 12 2011 11:17:50 GMT-0400 (EDT)" -v http://localhost:3000/container1/foo.txt

    > GET /container1/foo.txt HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Mon, 12 Sep 2011 17:44:41 +0000
    > If-Modified-Since:Mon Sep 12 2011 11:17:50 GMT-0400 (EDT)

    < HTTP/1.1 200 OK
    < X-Powered-By: Express
    < Connection: close
    < content-type: binary/octet-stream
    < date: Mon Sep 12 2011 13:44:42 GMT-0400 (EDT)
    < Server: FS
    < Content-Length: 11
    < Last-Modified: Mon Sep 12 2011 11:17:51 GMT-0400 (EDT)
    < ETag: 7c12772809c1c0c3deda6103b10fdfa0
    < Accept-Ranges: bytes

    1234567890

but 

    curl -H "If-Unmodified-Since:Mon Sep 12 2011 11:17:50 GMT-0400 (EDT)" -v http://localhost:3000/container1/foo.txt

    > GET /container1/foo.txt HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Mon, 12 Sep 2011 17:50:25 +0000
    > If-Unmodified-Since:Mon Sep 12 2011 11:17:50 GMT-0400 (EDT)

    < HTTP/1.1 412 Precondition Failed
    < X-Powered-By: Express
    < Connection: close
    < content-type: application/xml
    < date: Mon Sep 12 2011 13:50:25 GMT-0400 (EDT)
    < Server: FS
    < Transfer-Encoding: chunked

    <?xml version="1.0" encoding="UTF-8"?>
    <Error>
      <Code>PreconditionFailed</Code>
      <Message>At least one of the preconditions you specified did not hold.</Message>
    </Error>

and

    curl -v -H "If-Modified-Since:Mon Sep 12 2011 11:17:51 GMT-0400 (EDT)" http://localhost:3000/container1/foo.txt

    > GET /container1/foo.txt HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Mon, 12 Sep 2011 15:31:03 +0000
    > If-Modified-Since:Mon Sep 12 2011 11:17:51 GMT-0400 (EDT)

    < HTTP/1.1 304 Not Modified
    < X-Powered-By: Express
    < Connection: close
    < content-type: application/xml
    < date: Mon Sep 12 2011 11:31:03 GMT-0400 (EDT)
    < Server: FS

### HEAD requests

HEAD requests are identical to GET requests except they never return a response payload. Note that the response Content-Length header is set to the length of the stored content even though no content is actually included. 

    curl -v -X HEAD http://localhost:3000/container1/foo.txt

    > HEAD /container1/foo.txt HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Mon, 12 Sep 2011 17:58:28 +0000

    < HTTP/1.1 200 OK
    < X-Powered-By: Express
    < Connection: close
    < content-type: binary/octet-stream
    < date: Mon Sep 12 2011 13:58:28 GMT-0400 (EDT)
    < Server: FS
    < Content-Length: 11
    < Last-Modified: Mon Sep 12 2011 11:17:51 GMT-0400 (EDT)
    < ETag: 7c12772809c1c0c3deda6103b10fdfa0
    < Accept-Ranges: bytes

### Create or Replace or Copy file

Files are created, replaced, or copied with a PUT request. If the file-key already exists, the service will replace the existing file with the new one. 

PUT operations are all-or-nothing. There is currently no support for partial writes, or resumable writes. Concurrent PUTs with the same key result in a single winner. Currently there is no versioning support for catching multiple files created with the same key.

PUT requests must have a content-length header. There is no support for streaming uploads without predefined length.

    PUT http://<service-endpoint>/<container-name>/<file-key>

Sample exchange

    curl -v -X PUT -T foo.txt http://localhost:3000/container1/foo.txt

    > PUT /container1/foo.txt HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Mon, 12 Sep 2011 15:17:51 +0000
    > Content-Length: 11
    > Expect: 100-continue

    < HTTP/1.1 100 Continue
    < HTTP/1.1 200 OK
    < X-Powered-By: Express
    < Connection: close
    < date: Mon Sep 12 2011 11:17:51 GMT-0400 (EDT)
    < Server: FS
    < ETag: 7c12772809c1c0c3deda6103b10fdfa0
    < content-length: 0

If the request includes an (optional) `content-md5` header, the value of this header is compared to the MD5 hash of the blob for integrity.

The following optional headers in a PUT requests result in metadata being stored with the file, for retrieval in future GET requests.

- x-blb-meta-? : for user defined metadata
- cache-control : standard HTTP
- content-disposition : standard HTTP
- content-encoding : standard HTTP
- cache-control : standard HTTP
- expires : standard HTTP
- content-type : standard HTTP

Using a special header `x-blb-copy-from` allows the PUT to make a copy of an existing file, with a different key say or different metadata, or in a different container, without re-submitting the actual blob.

E.g.

    curl -v -X PUT -H "x-blb-copy-from: /container1/foo.txt" http://localhost:3000/container1/foo2.txt

    > PUT /container1/foo2.txt HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Mon, 12 Sep 2011 20:34:21 +0000
    > x-blb-copy-from: /container1/foo.txt

    < HTTP/1.1 200 OK
    < X-Powered-By: Express
    < Connection: close
    < content-type: application/xml
    < date: Mon Sep 12 2011 16:34:21 GMT-0400 (EDT)
    < Server: FS
    < ETag: 7c12772809c1c0c3deda6103b10fdfa0
    < content-length:

    <?xml version="1.0" encoding="UTF-8"?>
    <FileCopy xmlns="https://github.com/vmware-bdc/vblob/">
      <LastModified>2011-09-12T20:31:35.000Z</LastModified>
      <ETag>&quot;7c12772809c1c0c3deda6103b10fdfa0&quot;</ETag>
    </FileCopy>


### Delete file

    DELETE http://<service-endpoint>/<container-name>/<file-key>

Sample exchange (successful)

    curl -X DELETE -v http://localhost:3000/container1/foo.txt

    > DELETE /container1/foo.txt HTTP/1.1
    > User-Agent: curl/7.19.7 (universal-apple-darwin10.0) libcurl/7.19.7 OpenSSL/0.9.8r zlib/1.2.3
    > Host: localhost:3000
    > Accept: */*
    > Date: Thu, 18 Aug 2011 19:32:21 +0000

    < HTTP/1.1 204 No Content
    < X-Powered-By: Express
    < Connection: close
    < date: Thu Aug 18 2011 12:32:21 GMT-0700 (PDT)
    < Server: FS

Sample response (error)

    HTTP/1.1 404 Not Found
    X-Powered-By: Express
    Connection: close
    content-type: application/xml
    date: Thu Aug 18 2011 12:33:53 GMT-0700 (PDT)
    Server: FS
    content-length: 108

    <?xml version="1.0" encoding="UTF-8"?>
    <Error>
      <Code>NoSuchFile</Code>
      <Message>No such file</Message>
    </Error>
