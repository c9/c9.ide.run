/**
 * Runs a single process at a time
 *
 * @copyright 2010, Ajax.org B.V.
 * @license GPLv3 <http://www.gnu.org/licenses/gpl.txt>
 */

define(function(require, module, exports) {
    main.consumes = [
        "plugin", "proc", "settings", "fs", "menus", "c9",
        "tabs", "preferences" //@todo move tabs and preferences to the ui part of run
    ];
    main.provides = ["run"];
    return main;

    // @todo auto/console/@autoshow

    function main(options, imports, register) {
        var Plugin      = imports.plugin;
        var settings    = imports.settings;
        var prefs       = imports.preferences;
        var proc        = imports.proc;
        var tabs        = imports.tabs;
        var fs          = imports.fs;
        var menus       = imports.menus;
        var c9          = imports.c9;
        
        /***** Initialization *****/
        
        var handle     = new Plugin("Ajax.org", main.consumes);
        var handleEmit = handle.getEmitter();
        
        const STOPPING = -1;
        const STOPPED  = 0;
        const STARTING = 1;
        const STARTED  = 2;
        
        const TMUX = options.tmux || "~/.c9/bin/tmux";
        const BASH = "bash"; // /bin/bash
        
        var runners   = options.runners;
        var testing   = options.testing;
        var base      = options.base;
        var processes = [];
        
        var loaded = false;
        function load(){
            if (loaded) return false;
            loaded = true;
            
            // @todo, this should probably be abstracted away to the output plugin / run plugin
//                stProcessRunning.addEventListener("activate", function() {
//                    var autoshow = settings.model.queryValue("user/console/@autoshow");
//                    if (_self.autoOpen && apf.isTrue(autoshow)) {
//                        setTimeout(function(){
//                            _self.show();
//                            _self.showOutput();
//                        }, 200);
//                    }
//                    else {
//                        if (self.tabConsole && tabConsole.visible)
//                            _self.showOutput();
//                    }
//                });

            // Check for running process
//            findPID(function(err, storedPID){
//                if (err || !storedPID) {
//                    if (running > 0) stop();
//                    return;
//                }
//                
//                pid = storedPID;
//                
//                // if there's a PID we're running
//                running = STARTED;
//                emit("started", storedPID);
//                
//                // Lets double check if the PID is still alive
//                monitor(function(track){ track(function(){}); }, function(){});
//            });
            
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
        
//        function findPID(callback){
//            // var pid = settings.getNumer("user/run/@pid");
//            // if (pid) return callback(null, pid);
//            
//            fs.readFile(PIDFILE, "utf8", function(err, data){
//                return callback(err, data);
//            });
//        }
        
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
            var ext = fs.getExtension(options.path);
            
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
                    var builder = runners[name];
                    if (builder.selector == "source." + ext)
                        return callback(null, builder);
                }
                
                var err = new Error("Could not find Runner");
                err.code = "ERUNNERNOTFOUND";
                callback(err);
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
                })
            }
        }
        
        function run(runner, options, name, callback){
            if (typeof name == "function") {
                callback = name;
                name = null;
            }
            
            if (!name)
                name = "output";
            
            (options instanceof Array ? options : [options]).forEach(function(a){
                if (a.path)
                    a.path = base + a.path;
            });
            
            var proc = new Process(name, runner, options, callback);
            processes.push(proc);
            
            var event = { process: proc };
            
            proc.on("starting", function(){ handleEmit("starting", event); })
            proc.on("started", function(){ handleEmit("started", event); })
            proc.on("stopping", function(){ handleEmit("stopping", event); })
            proc.on("stopped", function(){ 
                handleEmit("stopped", event); 
                processes.remove(proc);
            })
            
            return proc;
        }
        
        function stopAll(){
            processes.forEach(function(proc){
                proc.stop();
            })
        }
        
        /***** Process Class *****/
            
        function Process(procName, runner, options, callback){
            var plugin = new Plugin("Ajax.org", main.consumes);
            var emit   = plugin.getEmitter();
            emit.setMaxListeners(100);
            
            var running = STOPPED;
            var pid, process;
            
            var PIDFILE, PIDMATCH, WATCHFILE;
            if (testing) {
                PIDFILE   = "/.run_" + procName + ".pid";
                WATCHFILE = "/.run_" + procName + ".watch";
                PIDMATCH  = new RegExp("^"
                    + (c9.platform == "darwin" ? "\\s*\\d+" : "")
                    + "\\s*(\\d+)\\s.*echo -n > "
                    + base.replace(/\//g, "\\/") + "\\/\\.run_" + procName 
                    + "\\.watch", "m");
            }
            else {
                PIDFILE   = "~/.c9/.run_" + procName + ".pid";
                WATCHFILE = "~/.c9/.run_" + procName + ".watch";
                PIDMATCH  = new RegExp("^"
                    + (c9.platform == "darwin" ? "\\s*\\d+" : "")
                    + "\\s*(\\d+)\\s.*echo -n > "
                    + "~\\/\\.c9\\/\\.run_" + procName + "\\.watch", "m");
            }
            var WATCHFILE_PREFIXED = (testing ? base : "") + WATCHFILE;
            var TRUNCATE = "; ([ -e " + WATCHFILE_PREFIXED + " ] "
                + "&& echo > " + WATCHFILE_PREFIXED + ")";
    
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
                        cmd += "echo '" + runner.info.replace(/'/g, "") + "' ; ";
                        
                    // Set the PATH variable if needed
                    if (runner.path)
                        cmd += "PATH=" + runner.path + " ; ";
    
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
                    "\\;", "set-option", "remain-on-exit", "on"
                ];
                // if (options.detach !== false)
                //     args.push("\\;", "detach-client");
                
                monitor(function(track){
                    // Create new session
                    proc.pty(BASH, {
                        args : ["-c", args.join(" ")],
                        cols : 100,
                        rows : 5,
                        env  : runner.env,
                        cwd  : options.cwd || runner[0].working_dir 
                            || options.path && fs.getParentPath(options.path) || "/"
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
                            pty.on("data", function(data){ emit("data", data); })
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
                    var match = stdout.match(PIDMATCH);
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
            
            function getVariable(name, path){
                var fnme, idx, ppath;
                
                if (name == "file") 
                    return path || "";
                if (name == "file_path")
                    return fs.getParentPath(path || "");
                if (name == "file_name") 
                    return fs.getFilename(path || "");
                if (name == "file_extension") {
                    if (!path) return "";
                    fnme = fs.getFilename(path);
                    idx = fnme.lastIndexOf(".");
                    return idx == -1 ? "" : fnme.substr(idx + 1);
                }
                if (name == "file_base_name") {
                    if (!path) return "";
                    fnme = fs.getFilename(path);
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
                    ppath = tabs.focussedPage && tabs.focussedPage.path;
                    if (!ppath) return "";
                    return getVariable(name.replace("project", "name"), ppath);
                }
                if (name == "hostname")
                    return c9.hostname;
                if (name == "port")
                    return c9.port;
                if (name == "ip")
                    return "0.0.0.0";
                
                return "$" + name;
            }
            function insertVariables(cmd, options){
                cmd = cmd.replace(/(^|[^\\])\$([\w_]+)|(^|[^\\])\$\{([^}]+)\}/g, 
                function(m, char, name, nchar, nacco){
                    if (char)
                        return char + getVariable(name, options.path);
                    else if (nchar) {
                        
                        // Test for default value
                        if (nacco.match(/^([\w_]+)\:(.*)$/))
                            return nchar + (getVariable(RegExp.$1, options.path) || RegExp.$2);
                            
                        // Test for conditional value
                        if (nacco.match(/^([\w_]+)\?(.*)$/))
                            return nchar + (options[RegExp.$1] ? RegExp.$2 : "");
                            
                        // Test for regular expression
                        if (nacco.match(/^([\w_]+)\/(.*)$/)) {
                            function reverse(str){ 
                                return str.split('').reverse().join('');
                            }
                            
                            return nchar + reverse(nacco)
                                .replace(/^\/?(.*)\/(?!\\)(.*)\/(?!\\)([\w_]+)$/, 
                                function (m, replace, find, name){
                                    var data = getVariable(reverse(name), options.path);
                                    var re   = new RegExp(reverse(find), "g");
                                    return data.replace(re, reverse(replace));
                                })
                        }
                        
                        // Assume just a name
                        return nchar + getVariable(nacco, options.path);
                    }
                });
                
                return cmd;
            }
            
            function cleanup(){
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
                    });
                });
            }
            
            function stop(callback){
                if (!running)
                    return callback();
                
                if (!pid) {
                    // If there's no PID yet, wait until we get one and then stop
                    if (running === STARTING) {
                        plugin.on("started", function(e){
                            if (e.pid > 0)
                                stop(callback);
                            else
                                callback();
                        });
                    }
                    else {
                        cleanup();
                        callback(new Error("Could not get PID from running "
                            + "process. Process might still be running in the "
                            + "background."));
                    }
                    return;
                }
    
                // Kill the pty session
                proc.execFile("kill", {args:[pid]}, function(err, e){
                    // Clean up here to make sure runner is in correct state
                    // when the callback is called
                    cleanup();
    
                    // When killing the process file won't be rewritten
                    if (!err) {
                        
                        fs.writeFile(WATCHFILE, "", "utf8", function(err){
                            callback(err, e);
                        });
                    }
                    else
                        callback(err, e);
                });
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
             * Process representation of process started with the runner
             * 
             * @property running {Number} Indicates the state of the process.
             * @property runner {Object} The object describing how to run the process.
             * @property pid {Number} The pid of the running process if any
             * 
             * @property STOPPING {-1} to be tested against the `runner` property. Indicates the process is being killed.
             * @property STOPPED  {0} to be tested against the `runner` property. Indicates the process is not running.
             * @property STARTING {1} to be tested against the `runner` property. Indicates the process is getting started.
             * @property STARTED  {2} to be tested against the `runner` property. Indicates the process is running.
             * 
             * @event stopping Fires when the process is going to be killed
             * @event stopped Fires when the process stopped running
             * @event starting Fires when the process is being started
             * @event started Fires when the process is started. This event also fires during startup if there's a PID file present
             * @event draw 
             */
            plugin.freezePublicAPI({
                STOPPING : STOPPING,
                STOPPED  : STOPPED,
                STARTING : STARTING,
                STARTED  : STARTED,
                
                get running(){ return running; },
                get runner(){ return runner; },
                get pid(){ return pid; },
                get name(){ return procName; },
                
                /**
                 * Detach from the currently running process. This is only 
                 * relevant if options.detach was set to false when starting 
                 * the process.
                 */
                detach : detach,
                
                /**
                 * Stop the currently running process, if any
                 * @param callback(err, e) {Function} called when the process is stopped
                 */
                stop : stop
            });
            
            run(runner, options, callback);
            
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
         * Runs arbitrary programs and code within Cloud9 IDE
         * 
         * @property processes {Array} List of running processes
         * 
         * @property STOPPING {-1} to be tested against the `running` property. Indicates the process is being killed.
         * @property STOPPED  {0} to be tested against the `running` property. Indicates the process is not running.
         * @property STARTING {1} to be tested against the `running` property. Indicates the process is getting started.
         * @property STARTED  {2} to be tested against the `running` property. Indicates the process is running.
         * 
         * @event stopping Fires when the process is going to be killed
         *   object:
         *   process {Process} the process that is stopping
         * @event stopped Fires when the process stopped running
         *   object:
         *   process {Process} the process that is stopped
         * @event starting Fires when the process is being started
         *   object:
         *   process {Process} the process that is starting
         * @event started Fires when the process is started. This event also fires during startup if there's a PID file present
         *   object:
         *   process {Process} the process that is stopped
         */
        handle.freezePublicAPI({
            STOPPING : STOPPING,
            STOPPED  : STOPPED,
            STARTING : STARTING,
            STARTED  : STARTED,
            
            get processes(){ return processes; },
            get runners(){ return runners; },
            
            /**
             * Retrieves an array of names of runners available to the system.
             * A runner is a JSON file that describes how a certain file can
             * be executed. The JSON file format is based on and compatible with
             * the sublime build scripts. Besides the build in runners, the
             * user can store runners in ~/.c9/runners. This list will contain
             * both the user's runners as well as the build-in runners.
             * @param callback(err, runners) {Function} called when the runners are retrieved
             */
            listRunners : listRunners,
            
            /**
             * Retrieves an individual runner's JSON object based on it's name.
             * The names of available runners can be retrieved using `listRunners`.
             * @param callback(err, runner) {Function} called when the runner is retrieved
             */
            getRunner : getRunner,
            
            /**
             * Stop all running processes
             */
            stopAll : stopAll,
            
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
             * $file_path           The directory of the current file, e. g., C:\Files.
             * $file                The full path to the current file, e. g., C:\Files\Chapter1.txt.
             * $file_name           The name portion of the current file, e. g., Chapter1.txt.
             * $file_extension      The extension portion of the current file, e. g., txt.
             * $file_base_name      The name only portion of the current file, e. g., Document.
             * $packages            The full path to the Packages folder.
             * $project             The full path to the current project file.
             * $project_path        The directory of the current project file.
             * $project_name        The name portion of the current project file.
             * $project_extension   The extension portion of the current project file.
             * $project_base_name   The name only portion of the current project file.
             * $hostname            The hostname of the workspace
             * $port                The port assigned to the workspace
             * $ip                  The ip address to run a process against in the workspace
             *
             * The following declarations can be used to add defaults or regexp
             * replacements to the these variables:
             * 
             * ${debug?--debug}
             * This will emit --debug if the debug option is set to true
             * 
             * ${project_name:Default}
             * This will emit the name of the current project if there is one, otherwise Default.
             * 
             * ${file/\.php/\.txt/}
             * This will emit the full path of the current file, replacing .php with .txt.
             * 
             * @param runner {Object, "auto"} Object describing how to run a process. 
             *   Alternatively this can be set to "auto" to auto-detect the runner.
             *   object:
             *   cmd {Array} Array containing the command to run and its desired 
             *      arguments. If you don’t specify an absolute path, the 
             *      external program will be searched in your PATH, one of your 
             *      system’s environmental variables. The command can contain 
             *      variables.
             *   [file_regex] {RegExp} Regular expression (Perl-style) to 
             *      capture error output of cmd. See the next section for details.
             *   [line_regex] {RegExp} If file_regex doesn’t match on the 
             *      current line, but line_regex exists, and it does match on 
             *      the current line, then walk backwards through the buffer 
             *      until a line matching file regex is found, and use these two 
             *      matches to determine the file and line to go to.
             *   [selector] {RegExp} Used when the automatic selection of the
             *      runner is set. Cloud9 IDE uses this scope selector to 
             *      find the appropriate build system for the active view.
             *   [working_dir] {String} Directory to change the current 
             *      directory to before running cmd. The original current 
             *      directory is restored afterwards.
             *   [env] {Object} Dictionary of environment variables to be merged 
             *      with the current process’ before passing them to cmd.
             * 
             *      Use this element, for example, to add or modify environment 
             *      variables without modifying your system’s settings.
             *   [shell] {Boolean} If true, cmd will be run through the shell.
             *      In our implementation all commands run through the shell.
             *      This cannot be changed.
             *   [path] {String} This string will replace the current process’ 
             *      PATH before calling cmd. The old PATH value will be restored 
             *      after that.
             * 
             *      Use this option to add directories to PATH without having 
             *      to modify your system’s settings.
             *   [info] {String} message to be outputted in the output buffer
             *      prior to running the processes. This message can contain 
             *      variables.
             *   [variants] {Array} currently not supported.
             * @param options {Object} 
             *   object:
             *   path  {String} the path to the file to execute
             *   cwd   {String} the current working directory
             *   debug {Boolean} whether to start the process in debug mode
             * @param name   {String} the unique name of the output buffer. 
             *   Defaults to "output". There can only be one process running on
             *   an output buffer at the same time. After a process has ended
             *   the process object is stale.
             * @param callback {Function} called when the process is started
             * @returns process {Process} the process object
             */
            run : run
        });
        
        register(null, {
            run: handle
        });
    }
});
