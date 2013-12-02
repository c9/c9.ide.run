define(function(require, module, exports) {
    main.consumes = [
        "Plugin", "proc", "settings", "fs", "c9", "util",
        "tabManager", "preferences" //@todo move tabs and preferences to the ui part of run
    ];
    main.provides = ["run"];
    return main;

    function main(options, imports, register) {
        var Plugin      = imports.Plugin;
        var settings    = imports.settings;
        var prefs       = imports.preferences;
        var proc        = imports.proc;
        var util        = imports.util;
        var tabs        = imports.tabManager;
        var fs          = imports.fs;
        var c9          = imports.c9;
        
        var basename    = require("path").basename;
        var dirname     = require("path").dirname;
        
        /***** Initialization *****/
        
        var handle     = new Plugin("Ajax.org", main.consumes);
        var handleEmit = handle.getEmitter();
        
        var STOPPING = -1;
        var STOPPED  = 0;
        var STARTING = 1;
        var STARTED  = 2;
        
        var TMUX = options.tmux || "~/.c9/bin/tmux";
        var BASH = "bash";
        
        var runners   = options.runners;
        var testing   = options.testing;
        var base      = options.base;
        var processes = [];
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            // Settings
            settings.on("read", function(e){
                // Defaults
                settings.setDefaults("project/run", [
                    ["path", "~/.c9/runners"]
                ]);
            }, handle);
            
            settings.on("write", function(e){
                
            }, handle);
            
            // Preferences
            prefs.add({
                "Project" : {
                    "Run & Debug" : {
                        position : 300,
                        "Runner Path in Workspace" : {
                            type : "textbox",
                            path : "project/run/@path",
                            position : 1000
                        }
                    }
                }
            }, handle);

            // @todo Could consider adding a watcher to ~/.c9/runners
        }
        
        /***** Methods *****/
        
        function listRunners(callback){
            var runners = Object.keys(options.runners || {});
            fs.readdir(settings.get("project/run/@path"), function(err, files){
//                if (err && err.code == "ENOENT")
//                    return callback(err);
                
                if (files) {
                    files.forEach(function(file){
                        runners.push(file.name);
                    });
                }
                
                callback(null, runners);
            });
        }
        
        function detectRunner(options, callback){
            listRunners(function(err, names){
                if (err) return callback(err);
                
                var count = 0;
                names.forEach(function(name){
                    if (!runners[name]) {
                        count++;
                        getRunner(name, false, function(){
                            if (--count === 0)
                                done();
                        });
                    }
                });
                if (count === 0) done();
            });
            
            function done(){
                for (var name in runners) {
                    var runner = runners[name];
                    if (matchSelector(runner.selector, options.path))
                        return callback(null, runner);
                }
                
                var err = new Error("Could not find Runner");
                err.code = "ERUNNERNOTFOUND";
                callback(err);
            }
        }
        
        function matchSelector(selector, path){
            if (typeof selector == "string") {
                if (selector.indexOf("source.") === 0)
                    return selector == "source." + fs.getExtension(path);
                else {
                    var re   = new RegExp(selector);
                    var file = basename(path);
                    return re.test(file);
                }
            }
            else if (selector instanceof Array) {
                return selector.some(function(n){
                    return matchSelector(n, path);
                });
            }
            else {
                return false;
            }
        }
        
        function getRunner(name, refresh, callback){
            if (typeof refresh == "function") {
                callback = refresh;
                refresh  = false;
            }
            
            if (runners[name] && !refresh)
                callback(null, runners[name]);
            else {
                fs.readFile(settings.get("project/run/@path") + "/" 
                  + name, "utf8", function(err, data){
                    if (err)
                        return callback(err);
                    
                    var runner;
                    try{ runner = JSON.parse(data); }
                    catch(e){ return callback(e); }
                    
                    runners[name] = runner;
                    callback(null, runner);
                });
            }
        }
        
        function restoreProcess(state){
            return new Process(state);
        }
        
        function run(runner, options, name, callback){
            if (typeof name == "function") {
                callback = name;
                name = null;
            }
            
            if (!name)
                name = "output";
            
            (options instanceof Array ? options : [options]).forEach(function(a){
                if (a.path && a.path.charAt(0) === "/")
                    a.path = base + a.path;
            });
            
            var proc = new Process(name, runner, options, callback);
            processes.push(proc);
            
            var event = { process: proc };
            
            proc.on("starting", function(){ handleEmit("starting", event); });
            proc.on("started", function(){ handleEmit("started", event); });
            proc.on("stopping", function(){ handleEmit("stopping", event); });
            proc.on("stopped", function(){ 
                handleEmit("stopped", event); 
                processes.remove(proc);
            });
            
            return proc;
        }
        
        function stopAll(){
            processes.forEach(function(proc){
                proc.stop();
            });
        }
        
        /***** Process Class *****/
            
        function Process(procName, runner, options, callback){
            var plugin = new Plugin("Ajax.org", main.consumes);
            var emit   = plugin.getEmitter();
            emit.setMaxListeners(100);
            
            var running = STOPPED;
            var meta    = {};
            var pid, process;
            
            if (typeof procName == "object") {
                pid      = procName.pid;
                runner   = procName.runner;
                running  = procName.running;
                procName = procName.name;
            }
            
            var PIDFILE, PIDMATCH, WATCHFILE;
            if (testing) {
                PIDFILE   = "/.run_" + procName + ".pid";
                WATCHFILE = "/.run_" + procName + ".watch";
                PIDMATCH  = new RegExp("^"
                    + (c9.platform == "darwin" ? "\\s*\\d+" : "")
                    + "\\s*(\\d+)\\s.*echo > "
                    + base.replace(/\//g, "\\/") + "\\/\\.run_" + procName 
                    + "\\.watch", "m");
            }
            else {
                PIDFILE   = "~/.c9/.run_" + procName + ".pid";
                WATCHFILE = "~/.c9/.run_" + procName + ".watch";
                PIDMATCH  = new RegExp("^"
                    + (c9.platform == "darwin" ? "\\s*\\d+" : "")
                    + "\\s*(\\d+)\\s.*echo > "
                    + "~\\/\\.c9\\/\\.run_" + procName + "\\.watch", "m");
            }
            var WATCHFILE_PREFIXED = (testing ? base : "") + WATCHFILE;
            var TRUNCATE = "; ([ -e " + WATCHFILE_PREFIXED + " ] "
                + "&& echo > " + WATCHFILE_PREFIXED + ")";
            
            // Deal with connection issues
            c9.on("stateChange", function(e){
                if (e.state & c9.PROCESS) {
                    if (running == STARTED || running == STARTING)
                        checkState();
                }
                else if (running == STARTED || running == STARTING) {
                    emit("away");
                }
            });
    
            /***** Methods *****/
            
            function run(srunner, options, callback){
                // If we're already running something do nothing
                // @todo this check needs to be improved, to check the output buffer
                if (running && (!options || !options.force))
                    return callback(new Error("Already running"));
                
                running = STARTING;
                
                if (srunner == "auto") {
                    return detectRunner(options, function(err, runner){
                        if (err) return callback(err);
                        options.force = true;
                        run(runner, options, callback);
                    });
                }
                
                // Set the runner property
                runner = srunner;
                
                emit("starting");
                
                if (!(runner instanceof Array))
                    runner = [runner];
                    
                if (!(options instanceof Array))
                    options = [options];
                
                var cmd = runner.map(function(runner, idx){
                    var cmd = "";
                    
                    // Display a message prior to running the command
                    if (runner.info)
                        cmd += "printf '" + runner.info.replace(/%/g, "%%") + "\n' ; ";
                        
                    // Set the PATH variable if needed
                    if (runner.path)
                        cmd += "export PATH=" + runner.path + " ; ";
                        
                    var env = util.extend({}, options[idx].env, runner.env);
                    for (var name in env) {
                        cmd += "export " + name + "=" + env[name] + " ; ";
                    }
    
                    // Open a pty session with tmux on the output buffer
                    // @todo eventually this might be better in the output plugin
                    // The basic command to run
                    cmd += (options[idx].debug 
                      && runner["cmd-debug"] || runner.cmd).join(" ");
                    
                    // Replace variables
                    cmd = insertVariables(cmd, options[idx]);
                    
                    return cmd;
                }).join("; ");
                
                // The rest of the options are singular. Choosing the first option object for this.
                options = options[0];
    
                // Add a command to clear the pid file when done
                cmd += TRUNCATE;
                
                // This is fairly complex. We need to kill the session and then
                // immediately start the new session before any other session
                // has reconnected and created a new one. To do this we execute
                // both commands through bash.
                // (@fabian, @luca, @harutyun. Please help with this one, I believe
                // this can be fixed by going through a small bash script.)
                
                // @todo deal with escaped double quotes 
                var args = [
                    TMUX, "kill-session", "-t", procName, ";",
                    TMUX, "new", "-s", procName, '"' + cmd.replace(/"/g, '\\"') + '"',
                    "\\;", "set-option", "-g", "status", "off",
                    "\\;", "set-option", "destroy-unattached", "off",
                    //"\\;", "set-option", "mouse-resize-pane", "on",
                    "\\;", "set-option", "mouse-select-pane", "on",
                    //"\\;", "set-option", "mouse-select-window", "on",
                    //"\\;", "set-option", "mouse-utf8", "on",
                    "\\;", "set-option", "set-titles", "on",
                    // Note that the following line is absolutely necessary. 
                    // It keeps the output visible for the user.
                    "\\;", "set-option", "remain-on-exit", "on", 
                    "\\;", "set-window-option", "-g", "aggressive-resize", "on",
                    "\\;", "set-option", "-g", "prefix", "C-b"
                    
                ];
                // if (options.detach !== false)
                //     args.push("\\;", "detach-client");
                
                monitor(function(track){
                    // Create new session
                    proc.pty(BASH, {
                        args : ["-c", args.join(" ")],
                        cols : 100,
                        rows : 5,
                        cwd  : options.cwd || runner[0].working_dir 
                            || options.path && dirname(options.path) || "/"
                    }, function(err, pty){
                        // Handle a possible error
                        if (err)
                            return callback(err);
                        
                        // Set process variable for later use
                        process = pty;
                        
                        // Running
                        running = STARTED;
                        emit("started", { pty: pty });
                        
                        if (options.detach === false) {
                            pty.on("data", function(data){ emit("data", data); });
                            pty.on("exit", function(){ emit("detach"); });
                        }
                        else {
                            pty.write(String.fromCharCode(2) + "d");
                        }
                        
                        // Track the PID file
                        track(callback);
                    });
                }, callback);
            }
            
            var hasMonitor;
            function track(callback){
                // Find PID of process that just got started
                proc.execFile("ps", {
                    args: [c9.platform == "darwin" ? "-axf" : "axf"]
                }, function(err, stdout, stderr){
                    var match = stdout && stdout.match(PIDMATCH);
                    if (!match) {
                        // Process has already ended
                        cleanup();
                        
                        // Lets tell the callback
                        callback(null, -1);
                        
                        return;
                    }
                    
                    for (var i = match.length - 1; i >= 0; i--) {
                        if (match[i].indexOf("tmux") == -1) {
                            pid = match[i].trim().split(" ", 1)[0];
                            break;
                        }
                    }
                    
                    // Send the PID to the callback
                    callback(null, pid);
                    
                    // Store the PID in the settings
                    settings.set("user/run/@pid", pid);
                    
                    // Store the PID on disk, if the process is still running
                    if (running)
                        fs.writeFile(PIDFILE, pid, "utf8", function(){});
                });
            }
            
            function monitor(exec, callback){
                if (hasMonitor) {
                    exec(track);
                }
                else {
                    // Clear the PID file and make sure it exists
                    fs.writeFile(WATCHFILE, "-1", "utf8", function(err){
                        if (err)
                            return callback(err);
                        
                        // Set watcher
                        fs.watch(WATCHFILE, function(err, event, filename){
                            if (err) {
                                // If the process is running write the WATCHFILE  
                                // again and restart the monitor
                                if (hasMonitor && running > 0) {
                                    hasMonitor = false;
                                    monitor(exec, callback);
                                }
                                // Else tell the callback starting the monitor failed
                                else {
                                    cleanup();
                                    return callback(err);
                                }
                            }
                            
                            if (event == "init") {
                                hasMonitor = true;
                                return exec(track);
                            }
                            
                            fs.readFile(WATCHFILE, "utf8", function(err, data) {
                                if (err) {
                                    // If the process is running write the WATCHFILE  
                                    // again and restart the monitor
                                    if (running > 0) {
                                        hasMonitor = false;
                                        monitor(exec, callback);
                                    }
                                    
                                    // Else do nothing - the process is done
                                    return;
                                }
                                
                                if (data && data.trim().length)
                                    return;
                                
                                // Process is stopped
                                cleanup();
                            });
                        });
                    });
                }
            }
            
            function getVariable(name, path, args){
                var fnme, idx, ppath;
                
                if (name == "file") 
                    return (path || "") 
                        + (args && args.length ? " "  + args.join(" ") : "");
                if (name == "file_path")
                    return dirname(path || "");
                if (name == "file_name") 
                    return basename(path || "");
                if (name == "file_extension") {
                    if (!path) return "";
                    fnme = basename(path);
                    idx = fnme.lastIndexOf(".");
                    return idx == -1 ? "" : fnme.substr(idx + 1);
                }
                if (name == "file_base_name") {
                    if (!path) return "";
                    fnme = basename(path);
                    idx = fnme.lastIndexOf(".");
                    return idx == -1 ? fnme : fnme.substr(0, idx);
                }
                if (name == "packages")
                    return "~/.c9/packages";
                if (name == "project" || 
                    name == "project_path" || 
                    name == "project_name" ||
                    name == "project_extension" ||
                    name == "project_base_name"
                ) {
                    ppath = tabs.focussedTab && tabs.focussedTab.path;
                    if (!ppath) return "";
                    return getVariable(name.replace("project", "name"), ppath);
                }
                if (name == "hostname")
                    return c9.hostname;
                if (name == "port")
                    return c9.port;
                if (name == "ip")
                    return "0.0.0.0";
                if (name == "home")
                    return c9.home;
                return "$" + name;
            }
            function reverse(str){ 
                return str.split('').reverse().join('');
            }
            function insertVariables(cmd, options){
                cmd = cmd.replace(/(^|[^\\])\$([\w_]+)|(^|[^\\])\$\{([^}]+)\}/g, 
                function(m, char, name, nchar, nacco){
                    if (char)
                        return char + getVariable(name, options.path, options.args);
                    else if (nchar) {
                        
                        // Test for default value
                        if (nacco.match(/^([\w_]+)\:(.*)$/))
                            return nchar + (getVariable(RegExp.$1, options.path, options.args) || RegExp.$2);
                            
                        // Test for conditional value
                        if (nacco.match(/^([\w_]+)\?(.*)$/))
                            return nchar + (options[RegExp.$1] ? RegExp.$2 : "");
                            
                        // Test for regular expression
                        if (nacco.match(/^([\w_]+)\/(.*)$/)) {
                            return nchar + reverse(nacco)
                                .replace(/^\/?(.*)\/(?!\\)(.*)\/(?!\\)([\w_]+)$/, 
                                function (m, replace, find, name){
                                    var data = getVariable(reverse(name), options.path, options.args);
                                    var re   = new RegExp(reverse(find), "g");
                                    return data.replace(re, reverse(replace));
                                });
                        }
                        
                        // Assume just a name
                        return nchar + getVariable(nacco, options.path, options.args);
                    }
                });
                
                return cmd;
            }
            
            function cleanup(callback){
                if (running < 1)
                    return;
    
                if (running > 0) {
                    running = STOPPING;
                    emit("stopping");
                }
                
                fs.rmfile(PIDFILE, function(){
                    fs.rmfile(WATCHFILE, function(){
                        pid     = 0;
                        runner  = null;
                        running = STOPPED;
                        emit("stopped");
                        
                        callback && callback();
                    });
                });
            }
            
            function stop(callback){
                if (!running)
                    return callback();
                
                if (!pid) {
                    // If there's no PID yet, wait until we get one and then stop
                    if (running === STARTING) {
                        // Make sure the process times out
                        var timer = setTimeout(function(){
                            cleanup(function(){
                                callback(new Error("Could not get PID from process. "
                                    + "The process seemed to not be running anymore."));
                            });
                        }, 2000);
                        
                        plugin.on("started", function(e){
                            clearTimeout(timer);
                            
                            if (e.pid > 0)
                                stop(callback);
                            else
                                callback();
                        });
                    }
                    else {
                        cleanup(function(){
                            callback(new Error("Could not get PID from running "
                                + "process. Process might still be running in the "
                                + "background."));
                        });
                    }
                    return;
                }
    
                // Kill the pty session
                proc.execFile("kill", {args:[pid]}, function(err, e){
                    // Clean up here to make sure runner is in correct state
                    // when the callback is called
                    cleanup(function(){
                        // When killing the process file won't be rewritten
                        if (!err) {
                            fs.writeFile(WATCHFILE, "", "utf8", function(err){
                                callback(err, e);
                            });
                        }
                        else
                            callback(err, e);
                    });
                });
            }
            
            function checkState(){
                // Check the watch file
                fs.readFile(WATCHFILE, function(err, data) {
                    // Process is running
                    if (!err && data && data.trim().length) {
                        monitor(function(){ emit("back"); }, function(){});
                        return;
                    }
                    
                    // Process is stopped
                    cleanup();
                });
            }
            
            function getState(){
                return {
                    pid     : pid,
                    name    : procName,
                    running : running,
                    runner  : runner
                };
            }
            
            function detach(callback){
                // Kill the pty session
                if (process)
                    process.write(String.fromCharCode(2) + "d");
                
                // proc.execFile(TMUX, {
                //     args: [ "detach-client", "-t", procName ]
                // }, callback);
            }
            
            /***** Register and define API *****/
        
            /**
             * Represents a process started with a `runner`. 
             * 
             * See the {@link run#run run plugin} for information on how to
             * start a process.
             * 
             * @class run.Process
             */
            plugin.freezePublicAPI({
                /**
                 * @property {-1} STOPPING  Indicates the process is being 
                 * killed. To be tested against the `runner` property.
                 */
                STOPPING : STOPPING,
                /**
                 * @property  {0} STOPPED  Indicates the process is not running. 
                 * To be tested against the `runner` property.
                 */
                STOPPED  : STOPPED,
                /**
                 * @property {1} STARTING  Indicates the process is getting 
                 * started. To be tested against the `runner` property.
                 */
                STARTING : STARTING,
                /**
                 * @property  {2} STARTED  Indicates the process is running. 
                 * To be tested against the `runner` property.
                 */
                STARTED  : STARTED,
                
                /**
                 * @property {Number} running  Indicates the state of the process.
                 */
                get running(){ return running; },
                /**
                 * @property {Object} runner  The object describing how to run 
                 * the process.
                 */
                get runner(){ return runner; },
                /**
                 * @property {Number} pid  The pid of the running process if any
                 */
                get pid(){ return pid; },
                /**
                 * @property {String} name  The name of the process.
                 */
                get name(){ return procName; },
                /**
                 * @property {Object} meta
                 */
                get meta(){ return meta; },
                
                _events : [
                    /**
                     * Fires when the process is going to be killed
                     * @event stopping
                     */
                    "stopping",
                    /**
                     * Fires when the process stopped running
                     * @event stopped
                     */
                    "stopped",
                    /**
                     * Fires when the process is being started
                     * @event starting
                     */
                    "starting",
                    /**
                     * Fires when the process is started. This event also fires 
                     * during startup if there's a PID file present
                     * @event started
                     */
                    "started"
                ],
                
                /**
                 * Returns the state of this process for use later.
                 * @return {Object}
                 */
                getState : getState,
                
                /**
                 * Detach from the currently running process. This is only 
                 * relevant if options.detach was set to false when starting 
                 * the process.
                 */
                detach : detach,
                
                /**
                 * Stop the currently running process.
                 * @param {Function} callback     Called when the process is stopped
                 * @param {Error}    callback.err The error object, if an error 
                 * has occured.
                 */
                stop : stop
            });
            
            if (!pid)
                run(runner, options, callback || function(){});
            else
                checkState();
            
            return plugin;
        }
        
        /***** Lifecycle *****/
        
        handle.on("load", function(){
            load();
        });
        handle.on("enable", function(){
            
        });
        handle.on("disable", function(){
            
        });
        handle.on("unload", function(){
            loaded = false;
        });
        
        /***** Register and define API *****/
        
        /**
         * Runs arbitrary programs and code from within Cloud9 IDE based on a
         * runner. 
         * 
         * *NB.: If you just want to run a process in the background you should
         * use {@link proc#spawn} or related methods. This runner is architected
         * specifically for running (and debugging) processes in Cloud9 that the
         * user monitors in an {@link output} pane.*
         * 
         * Example:
         * 
         *     run.getRunner("node", false, function(err, runner){
         *         if (err) throw err.message;
         *         
         *         var process = run.run(runner, {
         *             path: "/helloworld.js"
         *         }, function(err, pid){
         *             if (err) throw err.message;
         * 
         *             console.log("The PID is ", pid);
         *         });
         *     });
         * 
         * You can also ask for auto-detection of the runner based on the file
         * extension:
         * 
         *     var process = run.run("auto", {
         *         path: "/helloworld.js"
         *     }, function(err, pid){
         *         if (err) throw err.message;
         *     
         *         console.log("The PID is ", pid);
         *     });
         * 
         * A runner is a simple struct that describes how to run a 
         * certain subset of files. For instance a runner describing how to run 
         * Node.js files looks like this:
         * 
         *     {
         *         "caption" : "Node.js",
         *         "cmd": [node, "${debug?--debug-brk=15454}", "$file"],
         *         "debugger": "v8",
         *         "debugport": 15454,
         *         "selector": "source.js",
         *         "info": "Your code is running at $hostname"
         *     }
         * 
         * The concept of runners is based on the
         * [Sublime Text(tm) Build Systems](http://docs.sublimetext.info/en/sublime-text-3/file_processing/build_systems.html),
         * and is compatible with that format. There are a several
         * built-in runners, and external plugins can add new runners as well.
         * Users can also add runners to their .c9/runners directory in
         * the workspace. We recommend users to commit these runners to their
         * repository.
         * 
         * The {@link build Cloud9 Build System} also uses a compatible
         * format for the cloud9 builders.
         * 
         * It is possible to combine builders and runners, therefore it is
         * often not needed to describe the build and run step in the same
         * definition.
         * 
         * A process is always started in a [TMUX](http://en.wikipedia.org/wiki/Tmux) 
         * session. TMUX is a PTY multi-plexer which has several advantages; 
         * multiple clients can connect to the same session and the sessions are 
         * kept even if no user is connected. 
         * 
         * You can connect an {@link output} pane to the started process to
         * see the output of your running process. The name passed to
         * {@link run#run} should be the same as the name of the output pane
         * you open:
         * 
         *     tabManager.open({
         *         editorType : "output", 
         *         active     : true,
         *         document   : {
         *             title  : "My Process Name",
         *             output : {
         *                 id : "name_of_process"
         *             }
         *         }
         *     }, function(){});
         * 
         * Note that by default the process name is "output" and is shown in the
         * default output panel (available via the View menu).
         * 
         * @singleton
         */
        handle.freezePublicAPI({
            /**
             * Indicates the process is being killed. To be tested against 
             * the `running` property.
             * @property {-1} STOPPING
             */
            STOPPING : STOPPING,
            /**
             * Indicates the process is not running. To be tested against 
             * the `running` property.
             * @property {0}  STOPPED 
             */
            STOPPED  : STOPPED,
            /**
             * Indicates the process is getting started. To be tested against 
             * the `running` property.
             * @property {1}  STARTING
             */
            STARTING : STARTING,
            /**
             * Indicates the process is running. To be tested against 
             * the `running` property.
             * @property {2}  STARTED 
             */
            STARTED  : STARTED,
            
            /**
             * @property {run.Process[]}  processes  List of running processes
             */
            get processes(){ return processes; },
            /**
             * @property {Object[]}  runners  List of available runners
             */
            get runners(){ return runners; },
            
            _events : [
                /**
                 * Fires when the process is going to be killed
                 * @event stopping
                 * @param {Object} e
                 * @param {run.Process} e.process the process that is stopping
                 */
                "stopping",
                /**
                 * Fires when the process stopped running
                 * @event stopped 
                 * @param {Object} e
                 * @param {run.Process} e.process the process that is stopped
                 */
                "stopped",
                /**
                 * Fires when the process is being started
                 * @event starting 
                 * @param {Object} e
                 * @param {run.Process} e.process the process that is starting
                 */
                "starting",
                /**
                 * Fires when the process is started. This event also fires 
                 * during startup if there's a PID file present
                 * @event started 
                 * @param {Object} e
                 * @param {run.Process} e.process the process that is stopped
                 */
                "started"
            ],
            
            /**
             * Retrieves an array of names of runners available to the system.
             * A runner is a JSON file that describes how a certain file can
             * be executed. The JSON file format is based on and compatible with
             * the sublime build scripts. Besides the build in runners, the
             * user can store runners in ~/.c9/runners. This list will contain
             * both the user's runners as well as the build-in runners.
             * @param {Function} callback           Called when the runners are retrieved
             * @param {Error}    callback.err       The error object if an error occurred.
             * @param {String[]} callback.runners   A list of names of runners.
             */
            listRunners : listRunners,
            
            /**
             * Detect the runner that will be used to run a certain file
             * @param {Object}   options
             * @param {Function} callback
             */
            detectRunner : detectRunner,
            
            /**
             * Retrieves an individual runner's JSON object based on it's name.
             * The names of available runners can be retrieved using `listRunners`.
             * @param {Function} callback         Called when the runner is retrieved
             * @param {Function} callback.err     The error object if an error occurred.
             * @param {Function} callback.runner  A runner object. See {@link #run} for more information.
             */
            getRunner : getRunner,
            
            /**
             * Stop all running processes
             */
            stopAll : stopAll,
            
            /**
             * Check whether a selector matches a certain path
             * @param {String/Array} selector
             * @param {String}       path
             */
            matchSelector : matchSelector,
            
            /**
             * Gets a process based on a pid
             * @param {Object} state  The state object returned by {@link run.Process.getState}.
             * @return {run.Process}
             */
            restoreProcess : restoreProcess,
            
            /**
             * Starts a process based on a runner and options that are passed.
             * The runner can specify how to run a file. The implementation is 
             * based on sublime's build scripts. I'm copying some of their 
             * documentation here below for now:
             * [Source: http://docs.sublimetext.info/en/latest/reference/build_systems.html]
             * 
             * Generated commands can contain variables that are replaced just
             * prior to running the command. The following list are the supported
             * variables:
             * 
             * <table>
             * <tr><td>Variable</td><td>               Description</td></tr>
             * <tr><td>"$file_path"</td><td>           The directory of the current file, e. g., C:\Files.</td></tr>
             * <tr><td>"$file"</td><td>                The full path to the current file, e. g., C:\Files\Chapter1.txt.</td></tr>
             * <tr><td>"$file_name"</td><td>           The name portion of the current file, e. g., Chapter1.txt.</td></tr>
             * <tr><td>"$file_extension"</td><td>      The extension portion of the current file, e. g., txt.</td></tr>
             * <tr><td>"$file_base_name"</td><td>      The name only portion of the current file, e. g., Document.</td></tr>
             * <tr><td>"$packages"</td><td>            The full path to the Packages folder.</td></tr>
             * <tr><td>"$project"</td><td>             The full path to the current project file.</td></tr>
             * <tr><td>"$project_path"</td><td>        The directory of the current project file.</td></tr>
             * <tr><td>"$project_name"</td><td>        The name portion of the current project file.</td></tr>
             * <tr><td>"$project_extension"</td><td>   The extension portion of the current project file.</td></tr>
             * <tr><td>"$project_base_name"</td><td>   The name only portion of the current project file.</td></tr>
             * <tr><td>"$hostname"</td><td>            The hostname of the workspace</td></tr>
             * <tr><td>"$port"</td><td>                The port assigned to the workspace</td></tr>
             * <tr><td>"$ip"</td><td>                  The ip address to run a process against in the workspace</td></tr>
             * </table>
             * 
             * The following declarations can be used to add defaults or regexp
             * replacements to the these variables:
             * 
             *     ${debug?--debug}
             * 
             * This will emit --debug if the debug option is set to true
             * 
             *     ${project_name:Default}
             * 
             * This will emit the name of the current project if there is one, otherwise Default.
             * 
             *     ${file/\.php/\.txt/}
             * 
             * This will emit the full path of the current file, replacing .php with .txt.
             * 
             * @param {Object/"auto"} runner Object describing how to run a process. 
             *   Alternatively this can be set to "auto" to auto-detect the runner.
             * @param {Array} runner.cmd Array containing the command to run and its desired 
             *  arguments. If you don’t specify an absolute path, the 
             *  external program will be searched in your PATH, one of your 
             *  system’s environmental variables. The command can contain 
             *  variables.
             * @param {RegExp} [runner.line_regex] If file_regex doesn’t match on the 
             *  current line, but line_regex exists, and it does match on 
             *  the current line, then walk backwards through the buffer 
             *  until a line matching file regex is found, and use these two 
             *  matches to determine the file and line to go to.
             * @param {RegExp} [runner.selector] Used when the automatic selection of the
             *  runner is set. Cloud9 IDE uses this scope selector to 
             *  find the appropriate build system for the active view.
             * @param {String} [runner.working_dir] Directory to change the current 
             *  directory to before running cmd. The original current 
             *  directory is restored afterwards.
             * @param {Object} [runner.env] Dictionary of environment variables to be merged 
             *  with the current process’ before passing them to cmd.
             * 
             *  Use this element, for example, to add or modify environment 
             *  variables without modifying your system’s settings.
             * @param {Boolean} [runner.shell] If true, cmd will be run through the shell.
             *  In our implementation all commands run through the shell.
             *  This cannot be changed.
             * @param {String} [runner.path] This string will replace the current process’ 
             *  PATH before calling cmd. The old PATH value will be restored 
             *  after that.
             * 
             *  Use this option to add directories to PATH without having 
             *  to modify your system’s settings.
             * @param {String} [runner.info] message to be outputted in the output buffer
             *  prior to running the processes. This message can contain 
             *  variables.
             * @param {Array} [runner.variants] currently not supported.
             * @param {Object}  options
             * @param {String}  options.path  the path to the file to execute
             * @param {String}  options.cwd   the current working directory
             * @param {Array}   options.args  arguments to be passed to the program
             * @param {Boolean} options.debug whether to start the process in debug mode
             * @param {String} name   the unique name of the output buffer. 
             *   Defaults to "output". There can only be one process running on
             *   an output buffer at the same time. After a process has ended
             *   the process object is stale.
             * @param {Function} callback     called when the process is started
             * @param {Error}    callback.err The error object if an error occurred.
             * @returns {run.Process} The process object
             */
            run : run
        });
        
        register(null, {
            run: handle
        });
    }
});
