/*jslint node: true, vars: true, plusplus: true*/
/*global require, process*/

"use strict";

var Promise = require("bluebird"),
    callbackfs = require("fs"),
    fs = Promise.promisifyAll(callbackfs),
    fsevents;

if (process.platform === "darwin") {
    fsevents = require("fsevents");
} else {
    fsevents = undefined;
}

function range(count) {
    var result = [],
        index = 0;
    
    while (index < count) {
        result.push(index++);
    }
    
    return result;
}

function createDirectories(path, width, depth) {
    if (--depth < 0) {
        return Promise.fulfilled();
    }

    var dirPromises = range(width)
        .map(function (elem, index) {
            var child = path + "/" + index;
            
            return new Promise(function (resolve) {
                callbackfs.exists(child, resolve);
            })
                .then(function (exists) {
                    if (exists) {
                        return Promise.fulfilled();
                    } else {
                        console.log("Creating: ", child);
                        return fs.mkdirAsync(child);
                    }
                })
                .then(createDirectories.bind(undefined, child, width, depth),
                    function (err) {
                        console.log("Unable to create: ", child);
                    });
        });
    
    return Promise.all(dirPromises);
}

function getAllDirectories(dirname) {
    return fs.readdirAsync(dirname)
        .then(function (names) {
            var paths = names.map(function (name) {
                return [dirname, name].join("/");
            });
            var statPromises = paths.map(function (path) {
                return fs.statAsync(path);
            });
            
            statPromises.push(paths);
            return Promise.settle(statPromises);
        })
        .then(function (statsAndPaths) {
            var inPaths = statsAndPaths.pop().value(),
                outPaths = [],
                outStats = [];
            
            statsAndPaths.forEach(function (promise, index) {
                if (promise.isFulfilled()) {
                    outPaths.push(inPaths[index]);
                    outStats.push(promise.value());
                } else {
                    console.log("Dropping: ", inPaths[index]);
                }
            });
            
            return [outPaths, outStats];
        })
        .spread(function (paths, stats) {
            return paths.filter(function (path, index) {
                return stats[index].isDirectory();
            });
        })
        .map(getAllDirectories)
        .reduce(function (total, current) {
            return total.concat(current);
        }, [dirname])
        .caught(function (err) {
            console.warn(err);
            return [dirname];
        });
}

function watchPath(path, callback) {
    var watcher;
    
    if (path[path.length - 1] === "/") {
        path = path.substring(0, path.length - 1);
    }
    
    if (fsevents) {
        console.log("Recursively watching: ", path);
        watcher = fsevents(path);
        watcher.on("change", function (path, info) {
            console.log("fsevents: ", path, info);
            callback(path);
        });
        return Promise.fulfilled();
    } else {
        return getAllDirectories(path)
            .map(function (dirname) {
                console.log("Directly watching: ", dirname);
                watcher = fs.watch(dirname);
                watcher.on("change", function (path) {
                    console.log("fs.watch: ", path);
                    callback(path);
                });
                watcher.on("error", function (err) {
                    console.log(err);
                });
            });
    }
}

var path = process.argv.length > 2 ? process.argv[2] : null;

if (!path) {
    console.err("Usage: index.js <path>");
    process.exit(1);
}

console.log("Path: ", path);

function watchedFileCallback(path) {
    console.log("change: ", path);
}

createDirectories(path, 2, 5)
    .then(watchPath.bind(undefined, path, watchedFileCallback));