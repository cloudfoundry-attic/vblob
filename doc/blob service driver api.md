# Blob Service driver API

Copyright (c) 2011 VMware, Inc.

## constructor

    driver = createDriver(options, callback)

`createDriver` is a factory method, and the only function exported by each driver module. The function returns an instance of a driver interface configured with the specified connection options. The Blob service is currently configured to call this method for FS type driver upon startup.

`options` is a hash variable that contains credentials for specific drivers. These corresponds to the `options` specified in config.json for each driver.

In addition, all drivers receive:

- `options.logger`: a logger file on which to call error(), debug(), info(), and warn() with a message string for logging purposes.

The FS driver receives:  

- `options.root`: the root folder storing all the blobs

createDriver() returns the driver file immediately, but internally it may still be waiting to finish initializing itself. The driver should also return itself in callback(driver) when it is done initializing.

## General request/response flow 

The driver api supports passage of request and response information between the client and the back-end service via an `options` file passed into the driver on some methods (see specific methods below), and via a `response_header` file on the return. Note that the names of headers are passed to and from driver methods as lower-cased JSON keys.

Inbound streams are passed to the driver as a stream file on which the driver can register `data` and `end` event handlers or connect via a `pipe()`. Similarly, outbound streams are returned by the driver as a `response_data` stream which the gateway can `pipe()` back to the client.

Each interface method includes a callback allowing requests to be processed by the driver asynchronously. The callback has the following signature:

    callback (response_code, response_header, response_body, response_data)

- `reponse_code` : HTTP response code
- `response_header` : array of HTTP headers
- `response_body` : response file for non-streaming responses -- will be converted to XML by the gateway
- `response_data` : null except for responses which stream back data -- must be an file that supports pipe()

## errors

Drivers should return errors via the callback (not via throw) as follows.

    callback (http-response-code, null, {"Error": { "Code": error-code, "Message": error-message }});


## container operations

### container list

    container_list (callback)

Enumerates all containers owned by the client.

The response body is a javascript file with the following structure: Note that there may be multiple files in the Container array, and CreationDate values follow the ISO convention for XML date strings.

    { ContainerList: { Containers: { Container: [ {Name: "Container1", CreationDate: "2011-10-01T01:20:36.000Z"}, ... ] }}}

The javascript file is converted to XML by the gateway before being sent back to the client.
Note that the gateway may insert Owner information if it has any.

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
        ...
      </Containers>
    </ContainerList>

### container create

    container_create (container_name, options, data_stream, callback)  

Creates a new container.

- `options` are parameters parsed from the request
- `data_stream` is an optional payload -- this parameter is currently ignored by fs driver.
- If the container already exists for the same account, the response is the same as a successfull creation (return 200).
- If the container name is invalid, return 400 and an error code `InvalidContainerName`.

### container delete

    container_delete (container_name, callback)

Driver should check if a container is empty. If not, driver should return 409 with error code `ContainerNotEmpty` 

### container options

    container_options (container_name, options, callback)  

Currently not implemented in any drivers, but intended to retrieve options and policies such as `location` and `logging` or ACLs.

## file operations

### file list

    file_list (container_name, options, callback)  

Returns a list of file keys in a container. 

`options` are query parameters parsed from request query

- `options.marker` : specifying the starting key for listing files
- `options.prefix` : specifying the prefix of files that should be listed
- `options.delimiter` : specifying the delimiter of files that should be listed
- `options.max-keys` : specifying the max number of files to be listed in on query

The result returned in the response_body of the callback is a JSON file with the following structure. Note that `Contents` array can contain a variable number of files.

    {
    "FileList": {
      "Name": "Container1",
      "Prefix": {},
      "Marker": {},
      "MaxKeys": "1000",
      "IsTruncated": "false",
      "Contents": [
      {
        "Key": "file_key1",
        "LastModified": "2011-07-27T17:29:23.000Z",
        "ETag": "\"0c0e7e404e17edd568853997813f9354\"",
        "Size": "47392",
        "StorageClass": "STANDARD"
      },
      {
        "Key": "file_key2",
        "LastModified": "2011-07-27T21:16:00.000Z",
        "ETag": "\"d1919d0a02a24aa16412301e9e9dfbe4\"",
        "Size": "58144",
        "StorageClass": "STANDARD"
      },
      ...
    ]}}

This response is the translated by the server into XML.

    <?xml version  ="1.0" encoding="UTF-8"?>
    <FileList xmlns="https://github.com/vmware-bdc/vblob/">
      <Name>Container1</Name>
      <Prefix/>
      <Marker/>
      <MaxKeys>1000</MaxKeys>
      <IsTruncated>false</IsTruncated>
      <Contents>
        <Key>file_key1</Key>
        <LastModified>2011-07-27T17:29:23.000Z</LastModified>
        <ETag>"0c0e7e404e17edd568853997813f9354"</ETag>
        <Size>47392</Size>
        <StorageClass>STANDARD</StorageClass>
      </Contents>
      <Contents>
        <Key>file_key2</Key>
        <LastModified>2011-07-27T21:16:00.000Z</LastModified>
        <ETag>"d1919d0a02a24aa16412301e9e9dfbe4"</ETag>
        <Size>58144</Size>
        <StorageClass>STANDARD</StorageClass>
      </Contents>
      ...
    </FileList>

### file read

Returns an file or part of an file, streamed back via `callback` through `response_data`.
If options

    file_read (container_name, file_key, options, callback)

`options` are parameters parsed from the request (mostly headers)

- `options.range` : range header
- `options.head` : get only the headers

The following options cause the request to behave conditionally based on the modification date or ETag (MD5 hash).

- `options.if-modified-since` 
- `options.if-unmodified-since`
- `options.if-match` 
- `options.if-none-match`

### file create

Creates or replaces an file with a particular file_key. If multiple concurrent requests occur, the last request to finish will win.

    file_create (container_name, file_key, options, metadata, data_stream, callback)

`options` are parameters parsed from the request (mostly headers) 

- `options.content-md5` : this is the base64 encoding of the md5 hash (unlike ETag which is in hex). If this is present the creation of the file will be conditional the value of this option matching the md5 hash of the incoming data stream.

`metadata` are additional names/values stored together with the blob and returned as headers in an file_read request

- `metadata.x-blb-meta-*` : user-defined metadata
- `metadata.content-type`
- `metadata.content-length` : this header is required
- `metadata.cache-control`
- `metadata.content-disposition`
- `metadata.content-encoding`
- `metadata.expires`


### file copy

Copies an file to another file with a different key, OR replaces the metadata on an file. This operation does not have an input stream.

    file_copy (container_name, file_key, source_container_name, source_file_key, options, metadata, callback)

`source_container_name` and `source_file_key` specify the source, which may be the same as the `container_name` and `file_key`

`options.x-blb-metadata-copy-or-replace` is optional and has either value `COPY` or `REPLACE`. When copying an file to itself, the value must be `REPLACE`, which causes existing metadata stored with the file to be replaced with new metadata from `metadata`. If the value is `COPY` metadata is copied from the existing file instead of coming from the request.

### file delete

    file_delete (container_name, file_key, callback)  

Deletes an file
