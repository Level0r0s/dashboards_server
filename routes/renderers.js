/**
 * Copyright (c) Jupyter Development Team.
 * Distributed under the terms of the Modified BSD License.
 */
/**
 * Renderers used in routes
 */
var config = require('../app/config');
var debug = require('debug')('dashboard-proxy:renderer');
var fs = require('fs');
var nbstore = require('../app/notebook-store');
var path = require('path');
var Promise = require('es6-promise').Promise;
var urljoin = require('url-join');

var DB_EXT = config.get('DB_FILE_EXT');
var INDEX_NB_NAME = config.get('DB_INDEX');
var reNbExt = new RegExp('\\' + DB_EXT + '$');

function _renderList(req, res, next) {
    var listPath = req.params[0] || '';
    nbstore.list(listPath).then(
        function success(list) {
            // check each item to determine if a file or directory
            var statPromises = list.map(function(filename) {
                var url = urljoin(listPath, filename);
                return nbstore.stat(url).then(
                    function success(stats) {
                        var type;
                        if (stats.isDashboard) {
                            type = 'dashboard';
                        } else if (stats.isDirectory()) {
                            type = 'directory';
                        } else if (stats.isFile()) {
                            type = 'file';
                        }
                        var filepath = type === 'directory' ? url :
                                path.join(path.dirname(url), path.basename(url, DB_EXT));
                        return {
                            type: type,
                            path: filepath
                        };
                    }
                );
            });

            // render parent directory listing if not at root
            if (listPath.length > 0) {
                statPromises.unshift({
                    type: 'directory',
                    path: urljoin(listPath, '..')
                });
            }

            // render the list once all items have a type
            Promise.all(statPromises).then(
                function success(values) {
                    res.status(200);
                    res.render('list', {
                        username: req.session.username,
                        items: values,
                        title: 'Dashboards',
                        url: req.params[0]
                    });
                },
                function failure(err) {
                    next(err);
                }
            );
        },
        function failure(err) {
            next(err);
        }
    );
}

function _renderDashboard(req, res, next, opts) {
    var dbpath = (opts && opts.dbpath) || req.params[0];
    var hideChrome = !!(opts && opts.hideChrome);
    var stats = (opts && opts.stats) || nbstore.stat(dbpath);

    Promise.resolve(stats).then(function(stats) {
        if (stats.hasIndex) {
            dbpath = path.join(dbpath, INDEX_NB_NAME);
        } 
        return nbstore.get(dbpath);
    })
    .then(function success(notebook) {
        debug('Success loading nb');

        res.status(200);
        res.render('dashboard', {
            title: path.basename(dbpath, DB_EXT),
            notebook: notebook,
            username: req.session.username,
            hideChrome: hideChrome,
            supportsDeclWidgets: stats.supportsDeclWidgets,
            // need to set document.baseURI with trailing slash (i.e. "/dashboards/nb/") so
            // that relative paths load correctly
            baseURI: urljoin(req.originalUrl, '/')
        });
    })
    .catch(function error(err) {
        // TODO better way of determing the error
        err.status = err.message.indexOf('loading') === -1 ? 500 : 404;
        next(err);
    });
}

function _render(req, res, next, opts) {
    var dbpath = (opts && opts.dbpath) || req.params[0] || '/';
    var hideChrome = !!(opts && opts.hideChrome);
    var errorOnList = !!(opts && opts.errorOnList);

    // first, check if notebook file (with '.ipynb') exists for this path
    var dbpathWithExt = dbpath + (reNbExt.test(dbpath) ? '' : DB_EXT);
    nbstore.stat(dbpathWithExt)
        .catch(function(err) {
            if (dbpath === dbpathWithExt) {
                throw err;
            }

            // with extension didn't exist; try path directly
            return nbstore.stat(dbpath);
        })
        .then(function success(stats) {
            // found file or directory -- render appropriate HTML
            if (stats.isDashboard) {
                _renderDashboard(req, res, next, {
                    dbpath: dbpath,
                    hideChrome: hideChrome,
                    stats: stats
                });
            } else if (stats.isDirectory()) {
                if (errorOnList) {
                    var err = new Error('List not supported');
                    err.status = 404;
                    next(err);
                    return;
                }
                _renderList(req, res, next);
            } else {
                // plain file -- return contents
                res.sendFile(stats.fullpath);
            }
        })
        .catch(function failure(err) {
            // nothing found for given path
            if (err.code === 'ENOENT') {
                err.status = 404;
            }
            next(err);
        });
}

module.exports = {
    /**
     * Renders a dashboard or list of files or responds with an individual file
     * @param {Request}  req - HTTP request object
     * @param {Response} res - HTTP response object
     * @param {Function} next - next function
     * @param {Object} [opts] - additional options
     * @param {String} [opts.dbpath] - path to use instead of request param
     * @param {Boolean} [opts.hideChrome] - if true, disables UI chrome; defaults to false
     * @param {Boolean} [opts.stats] - object returned from `nbstore.stat()`; if not provided, calls
     *                                 `nbstore.stat()`
     */
    render: _render,
    /**
     * Renders the list of items at the directory specified in request param
     * @param {Request}  req - HTTP request object
     * @param {Response} res - HTTP response object
     * @param {Function} next - next function
     */
    renderList: _renderList,
    /**
     * Renders a dashboard at path specified by either request param or dbpath
     * @param {Request}  req - HTTP request object
     * @param {Response} res - HTTP response object
     * @param {Function} next - next function
     * @param {Object} [opts] - additional options
     * @param {String} [opts.dbpath] - path to use instead of request param
     * @param {Boolean} [opts.hideChrome] - if true, disables UI chrome; defaults to false
     * @param {Boolean} [opts.stats] - object returned from `nbstore.stat()`; if not provided, calls
     *                                 `nbstore.stat()`
     */
    renderDashboard: _renderDashboard
};