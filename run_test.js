/*global describe it before after  =*/

"use client";

require(["lib/architect/architect", "lib/chai/chai", "/vfs-root"], 
  function (architect, chai, baseProc) {
    var expect = chai.expect;
    
    expect.setupArchitectTest([
        {
            packagePath : "plugins/c9.core/c9",
            workspaceId : "ubuntu/ip-10-35-77-180",
            startdate   : new Date(),
            debug       : true,
            hosted      : true,
            local       : false,
            hostname    : "dev.javruben.c9.io",
            davPrefix   : "/",
            platform    : navigator.appVersion.indexOf("Mac OS X") > -1 ? "darwin" : "linux"
        },
        
        "plugins/c9.core/ext",
        "plugins/c9.core/http",
        "plugins/c9.core/util",
        "plugins/c9.ide.ui/lib_apf",
        {
            packagePath : "plugins/c9.core/settings",
            settings : "<settings><state><console>" + JSON.stringify({
                type  : "pane", 
                nodes : [
                    {
                        type : "tab",
                        editorType : "output",
                        document : { title : "Output" },
                        active : "true"
                    },
                    {
                        type : "tab",
                        editorType : "output",
                        document : {
                            title : "Output2",
                            "output" : {
                                id : "output2"
                            }
                        }
                    }
                ]
            }) + "</console></state></settings>"
        },
        {
            packagePath  : "plugins/c9.ide.ui/ui",
            staticPrefix : "plugins/c9.ide.ui"
        },
        "plugins/c9.ide.editors/document",
        "plugins/c9.ide.editors/undomanager",
        "plugins/c9.ide.editors/editors",
        "plugins/c9.ide.editors/editor",
        {
            packagePath : "plugins/c9.ide.editors/tabmanager",
            testing     : 2
        },
        "plugins/c9.ide.editors/pane",
        "plugins/c9.ide.editors/tab",
        "plugins/c9.ide.terminal/terminal",
        "plugins/c9.ide.run/output",
        "plugins/c9.ide.console/console",
        "plugins/c9.fs/proc",
        "plugins/c9.fs/fs",
        "plugins/c9.vfs.client/vfs_client",
        "plugins/c9.vfs.client/endpoint",
        "plugins/c9.ide.auth/auth",
        {
            packagePath : "plugins/c9.ide.run/run",
            testing     : true,
            base        : baseProc,
            runners     : {
                "node" : {
                    "caption" : "Node.js (current)",
                    "cmd": ["node", "${debug?--debug-brk=15454}", "$file"],
                    "debugger": "v8",
                    "debugport": 15454,
                    "file_regex": "^[ ]*File \"(...*?)\", line ([0-9]*)",
                    "selector": "source.js",
                    "info": "Your code is running at \\033[01;34m$hostname\\033[00m.\n"
                        + "\\033[01;31mImportant:\\033[00m use \\033[01;32mprocess.env.PORT\\033[00m as the port and \\033[01;32mprocess.env.IP\\033[00m as the host in your scripts!\n"
                },
                "pythoni" : {
                    "caption" : "Python in interactive mode",
                    "cmd": ["python", "-i"],
                    "selector": "source.python",
                    "info": "Hit \\033[01;34mCtrl-D\\033[00m to exit.\n"
                }
            }
        },
        
        // Mock plugins
        {
            consumes : ["apf", "ui", "Plugin"],
            provides : [
                "commands", "menus", "layout", "watcher", 
                "save", "preferences", "anims", "clipboard",
                
                "auth.bootstrap", "dialog.alert", "dialog.question", "dialog.filesave", "dialog.fileoverwrite"
            ],
            setup    : expect.html.mocked
        },
        {
            consumes : ["run", "proc", "fs", "tabManager", "console", "output"],
            provides : [],
            setup    : main
        }
    ], architect);
    
    function main(options, imports, register) {
        var run      = imports.run;
        var proc     = imports.proc;
        var fs       = imports.fs;
        var tabs     = imports.tabManager;
        var cnsl     = imports.console;
        
        function getHtmlElement(tab){
            if (typeof tab == "object")
                return tab.pane.aml.getPage("editor::" + tab.editorType).$ext;
        }
        expect.html.setConstructor(getHtmlElement);
        
        function countEvents(count, expected, done){
            if (count == expected) 
                done();
            else
                throw new Error("Wrong Event Count: "
                    + count + " of " + expected);
        }
        
        var maxTries = 3, retries = 0;
        function waitForOutput(match, callback){
            setTimeout(function(){
                if (retries < maxTries && !getHtmlElement(tabs.focussedTab).innerText.match(match)) {
                    retries++;
                    return waitForOutput(match, callback);
                }
                    
                expect.html(tabs.focussedTab, "Output Mismatch")
                    .text(match);
                
                callback();
            }, 500);
        }
        
        describe('run', function() {
            before(function(done){
                apf.config.setProperty("allow-select", false);
                apf.config.setProperty("allow-blur", false);

                bar.$ext.style.background = "rgba(220, 220, 220, 0.93)";
                bar.$ext.style.position = "fixed";
                bar.$ext.style.left = "20px";
                bar.$ext.style.right = "20px";
                bar.$ext.style.bottom = "20px";
                bar.$ext.style.height = "150px";
      
                document.body.style.marginBottom = "150px";
                done();
            });
            
            describe("listRunners()", function(){
                it('should list all runners', function(done) {
                    run.listRunners(function(err, runners){
                        if (err) throw err.message;
                        
                        expect(runners).length.gt(0);
                        done();
                    })
                });
            });
            
            describe("getRunner()", function(){
                it('should retrieve the runner of a certain type', function(done) {
                    run.getRunner("node", false, function(err, runner){
                        if (err) throw err.message;
                        
                        expect(runner).to.ok;
                        done();
                    })
                });
            });
            
            describe("run()", function(){
                this.timeout(10000);
                
                it('should run a file with a runner', function(done) {
                    var foundPid, count = 0;
                    
                    run.getRunner("node", false, function(err, runner){
                        if (err) throw err.message;
                        
                        expect(runner).to.ok;
                        
                        var c = "console.log('Hello World', new Date());";
                        
                        fs.writeFile("/helloworld.js", c, "utf8", function(err){
                            if (err) throw err.message;
                            
                            var process = run.run(runner, {
                                path: "/helloworld.js"
                            }, function(err, pid){
                                if (err) throw err.message;

                                expect(parseInt(pid, 10)).to.ok;
                                expect(process.running).to.not.equal(run.STARTING);

                                foundPid = true;
                            });
                            
                            expect(process.running).to.equal(run.STARTING);
                            
                            function c2(){ count++; }
                            process.on("started", c2);
                            process.on("stopping", c2);
                            
                            process.on("stopped", function c1(){
                                setTimeout(function(){
                                    expect(process.running).is.equal(run.STOPPED);
                                    expect(foundPid, "found-pid").to.ok;
                                    
                                    process.off("started", c2);
                                    process.off("stopping", c2);
                                    process.off("stopped", c1);
                                    count++;
                                    
                                    waitForOutput(/Hello\sWorld/, function(){
                                        fs.rmfile("/helloworld.js", function(){
                                            countEvents(count, 3, done);
                                        });
                                    });
                                }, 500);
                            });
                            
                            //expect(process.running).to.equal(run.STOPPED);
                        });
                    });
                });
                
                it('should run a file with a runner and stop it with stop()', function(done) {
                    var count = 0;
                    
                    run.getRunner("node", false, function(err, runner){
                        if (err) throw err.message;
                        
                        expect(runner).to.ok;
                        
                        var c = "setInterval(function(){console.log('Hello World', new Date());}, 500)";
                        
                        fs.writeFile("/helloworld.js", c, "utf8", function(err){
                            if (err) throw err.message;
                            
                            var process = run.run(runner, {
                                path: "/helloworld.js"
                            }, function(err, pid){
                                if (err) throw err.message;
                                
                                expect(parseInt(pid, 10), "Invalid PID").to.ok.to.gt(0);
                                expect(process.running).to.equal(run.STARTED);
                                
                                setTimeout(function(){
                                    process.stop(function(err, e){
                                        if (err) throw err.message;
                                    });
                                }, 1000);
                            });
                            
                            expect(process.running).to.equal(run.STARTING);
                            
                            function c2(){ count++; }
                            process.on("started", c2);
                            process.on("stopping", c2);
                            
                            process.on("stopped", function c1(){
                                expect(process.running).is.equal(run.STOPPED);
                                
                                process.off("started", c2);
                                process.off("stopping", c2);
                                process.off("stopped", c1);
                                count++;
                                
                                waitForOutput(/Hello\sWorld[\s\S]*Hello\sWorld/, function(){
                                    fs.rmfile("/helloworld.js", function(){
                                        countEvents(count, 3, done);
                                    });
                                });
                            });
                        });
                    });
                });
                
                it('should run an interactive proces in the second output window', function(done) {
                    var count = 0;
                    
                    var outputTab2 = tabs.getTabs()[1];
                    tabs.focusTab(outputTab2);
                    
                    run.getRunner("pythoni", false, function(err, runner){
                        if (err) throw err.message;
                        
                        expect(runner).to.ok;
                        
                        var process = run.run(runner, {}, "output2", function(err, pid){
                            if (err) throw err.message;
                            
                            expect(parseInt(pid, 10)).to.ok.to.gt(0);
                            expect(process.running).to.equal(run.STARTED);
                            
                            setTimeout(function(){
                                var output = outputTab2.editor;
                                
                                output.write("print 1\n");
                                
                                setTimeout(function(){
                                    output.write(String.fromCharCode(4));
                                }, 1000);
                            }, 1000);
                        });
                        
                        function c2(){ count++; }
                        process.on("started", c2);
                        process.on("stopping", c2);
                        
                        process.on("stopped", function c1(){
                            expect(process.running).is.equal(run.STOPPED);
                            
                            process.off("started", c2);
                            process.off("stopping", c2);
                            process.off("stopped", c1);
                            
                            waitForOutput(/Python/, function(){
                                count++;
                                countEvents(count, 3, done);
                            });
                        });
                        
                        expect(process.running).to.equal(run.STARTING);
                    })
                });
                
                it('should run a file with a runner automatically selected in the second output window', function(done) {
                    var foundPid, count = 0;
                    
                    var outputTab2 = tabs.getTabs()[1];
                    tabs.focusTab(outputTab2);
                    
                    run.getRunner("node", false, function(err, runner){
                        if (err) throw err.message;
                        
                        expect(runner).to.ok;
                        
                        var c = "console.log('Hello World', new Date());";
                        
                        fs.writeFile("/helloworld.js", c, "utf8", function(err){
                            if (err) throw err.message;
                            var process = run.run("auto", {
                                path: "/helloworld.js"
                            }, "output2", function(err, pid){
                                if (err) throw err.message;

                                expect(parseInt(pid, 10))
                                    .to.ok;
                                expect(process.running).to.not.equal(run.STARTING);

                                foundPid = true;
                            });
                            
                            expect(process.running).to.equal(run.STARTING);
                            
                            function c2(){ count++; }
                            process.on("started", c2);
                            process.on("stopping", c2);
                            
                            process.on("stopped", function c1(){
                                setTimeout(function(){
                                    expect(process.running).is.equal(run.STOPPED);
                                    expect(foundPid, "found-pid").to.ok;
                                    
                                    process.off("started", c2);
                                    process.off("stopping", c2);
                                    process.off("stopped", c1);
                                    count++;
    
                                    waitForOutput(/Hello\sWorld/, function(){
                                        fs.rmfile("/helloworld.js", function(){
                                            countEvents(count, 3, done);
                                        });
                                    });
                                });
                            });
                        });
                    });
                });
            });
            
            if (!onload.remain){
               after(function(done){
                    run.unload();
                    tabs.unload();
                    cnsl.unload();
                   
                   document.body.style.marginBottom = "";
                   done();
               });
            }
        });
        
        onload && onload();
    }
});