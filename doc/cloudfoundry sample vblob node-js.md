# cloudfoundry vblob sample using node.js

## reading the vblob service config from the environment 

This assumes that you have installed [express](https://github.com/visionmedia/express) globally

    $ sudo npm install -g express
    
Create a new app directory tree with a vanilla home page using express

    $ express vblob-demo1
    
Edit the package.json manifest to include [knox](https://github.com/learnboost/knox)  

    {
      "name": "vblob-demo",
      "version": "0.0.1",
      "private": true,
      "scripts": {
        "start": "node app"
      },
      "dependencies": {
        "express": "",
        "jade": "",
        "knox": ""
      }
    }
    
Now get the node-modules

    $ npm install
    
In order for the app to work in cloudfoundry, its http port needs to be configured from the environment.    
And to simplify the code, modify the boilerplate `app.js` as follows (you can also delete the routes folder)

    var express = require('express');
    var util = require('util');

    var port = process.env.VCAP_APP_PORT || 3000;
    var app = express();

    app.configure(function(){
      app.set('view engine', 'jade');
    });

    app.get('/', function(req, res){
      res.render('index1', { 
        title: 'vBlob sample', 
        env: util.inspect(process.env), 
      });
    });

    app.listen(port);
    console.log("Listening on port "+port);
    

And modify `views/index.jade` as follows

    extends layout

    block content
      h1= title
      pre= env

For more information about jade refer to [github](https://github.com/visionmedia/jade).

Test the app locally using

    $ node app
    Express server listening on port 3000

Using your browser open `http://localhost:3000/`.
You should see a simple page with the Title "Hello" and a list of your environment variables

Push this (vanilla) app to cloudfoundry to confirm that it will run. This assumes that you have signed up and can login.
When you push, choose an application name which is unique to you e.g. by prefixing with your own username instead of `username`.

    $ vmc target api.cloudfoundry.com
    $ vmc login
    $ vmc push
    Would you like to deploy from the current directory? [Yn]: 
    Application Name: username-vblob-sample
    Application Deployed URL [username-vblob-sample.cloudfoundry.com]: 
    Detected a Node.js Application, is this correct? [Yn]: 
    Memory Reservation (64M, 128M, 256M, 512M, 1G) [64M]: 
    Creating Application: OK
    Would you like to bind any services to 'username-vblob-sample'? [yN]: 
    Uploading Application:
      Checking for available resources: OK
      Processing resources: OK
      Packing application: OK
      Uploading (25K): OK   
    Push Status: OK
    Staging Application: OK
    Starting Application: OK

Using your browser open `http://username-vblob-sample.cloudfoundry.com/` or whatever you selected as the application name.
You should see the environment of your app running in cloudfoundry.com

Now provision an instance of vblob for your app.

    $ vmc create-service vblob vblob-sample username-vblob-sample
    Creating Service: OK
    Binding Service [vblob-sample]: OK
    Stopping Application: OK
    Staging Application: OK                                                         
    Starting Application: OK

Refresh your browser (pointing to your app at cloudfoundry.com) to see the new vblob service settings for your app. You should see a VCAP_SERVICES setting similar to the following (indented for readability):

    VCAP_SERVICES: '{
      "vblob-1.0":[{
        "name":"vblob-sample",
        "label":"vblob-1.0",
        "plan":"free",
        "tags":["vblob","vblob-1.0","nosql"],
        "credentials":{
          "hostname":"172.30.48.133",
          "host":"172.30.48.133",
          "port":45001,
          "username":"3551355d-980e-4584-b28c-0bb8d450d027",
          "password":"7c56e99a-681f-4d22-a417-1c1eef60c24c",
          "name":"0255bd6e-7949-4f83-80f8-7b82166e01e0"
    }}]}'

The important details above are the service `host:port` and `username:password` credentials. 

If you would like to run vblob locally, instructions are on [github])(https://github.com/cloudfoundry/vblob). This will allow you to test your app with a local instance of vlob before pushing it to cloudfoundry.com. Remember to turn on authentication because this is how the vblob service is running in cloudfoundry.

To make the code support both local vblob and cloudfoundry vblob service deployment, modify `app.js` as follows, replacing the default vblob_conf with whatever port and credentials you are running with on localhost.

    var express = require('express');
    var util = require('util');

    var port = process.env.VCAP_APP_PORT || 3000;
    var svcs = process.env.VCAP_SERVICES && JSON.parse(process.env.VCAP_SERVICES);
    var vblob_conf = svcs && svcs["vblob-1.0"] && svcs["vblob-1.0"][0].credentials ||
        {
          "host":"localhost",
          "port":9981,
          "username":"dummy",
          "password":"dummy"
        };

    var app = express();

    app.configure(function(){
      app.set('view engine', 'jade');
    });

    app.get('/', function(req, res){
      res.render('index', { 
        title: 'vBlob sample', 
        env: util.inspect(process.env), 
        vblob_conf: util.inspect(vblob_conf) 
      });
    });

    app.listen(port);
    console.log("Listening on port "+port);

And modify `views/index.jade` as follows

    extends layout

    block content
      h1= title
      pre= vblob_conf
      hr
      pre= env

Now update the app on cloudfoundry and check to make sure that the vblob_conf is not the default localhost config.

    $ vmc update jleschner-vblob-sample

# Getting down to business: connecting to vblob via knox

Modify `app.js` as follows

    var express = require('express');
    var util = require('util');
    var knox = require('knox');

    var port = process.env.VCAP_APP_PORT || 3000;
    var svcs = process.env.VCAP_SERVICES && JSON.parse(process.env.VCAP_SERVICES);
    var vblob_conf = svcs && svcs["vblob-1.0"] && svcs["vblob-1.0"][0].credentials ||
        {
          "host":"localhost",
          "port":9981,
          "username":"dummy",
          "password":"dummy"
        };

    var app = express();

    var knox = knox.createClient({
        endpoint: vblob_conf.host + ':' + vblob_conf.port,
        key: vblob_conf.username,
        secret: vblob_conf.password,
        bucket: 'sample'
    });

    app.configure(function(){
      app.set('view engine', 'jade');
    });

    app.get('/', function(req, res){
      res.render('index', { 
        title: 'vBlob sample', 
        env: util.inspect(process.env), 
        vblob_conf: util.inspect(vblob_conf),
        knox: util.inspect(knox)
      });
    });

    app.listen(port);
    console.log("Listening on port "+port);
  
and in index.jade

    extends layout

    block content
      h1= title
      pre= vblob_conf
      hr
      pre= env
      hr
      pre= knox
      
Now, when you run the app you should see the knox config

## Using caldecott to access a vblob instance
Refer to this page to see details of tunnelling to a vblob instance: http://blog.cloudfoundry.com/post/12928974099/now-you-can-tunnel-into-any-cloud-foundry-data-service

Basically when you have done the steps in the article to tunnel to a vblob instance, you will obtain a pair of username/password credentials. Suppose the proxy listens to localhost:10000, then you should be able to access the vblob instance provisioned in cloudfoundry.com by posting requests to http://localhost:10000

