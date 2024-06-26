var __scriptTypeModuleEval = function(__moduleSrc){
  new Function(__moduleSrc)();
};
(function () {
'use strict';

function currentScript() {
  return document.currentScript || document._currentScript || getCurrentScriptTheHardWay();
}

function getCurrentScriptTheHardWay() {
  // Should be more complex than this.
  var scripts = document.getElementsByTagName('script');
  return scripts[scripts.length - 1];
}

class Cluster {
  constructor(count){
    this.count = count;
    this.workerURL = new URL('./worker.js', document.currentScript.src);
    this.workers = [];
    this.spawn();
  }

  post(msg, handler) {
    let worker = this.leastBusy();
    worker.handlers[msg.url] = handler;
    worker.postMessage(msg);
    worker.inProgress++;
  }

  spawn() {
    for(var i = 0; i < this.count; i++) {
      let worker = new Worker(this.workerURL);
      this.handleMessages(worker);
      this.workers.push(worker);
    }
  }

  leastBusy() {
    this.workers.sort(function(a, b){
      if(a.inProgress < b.inProgress) {
        return -1;
      } else {
        return 1;
      }
    });
    return this.workers[0];
  }

  handleMessages(worker) {
    worker.inProgress = 0;
    worker.handlers = {};

    worker.onmessage = function(ev){
      let msg = ev.data;
      let handler = worker.handlers[msg.url];
      handler(msg);
      worker.inProgress--;
    };
  }
}

var addModuleTools = function(registry, dynamicImport){
  self._importTypeModuleTools = function(url){
    let moduleScript = registry.get(url);
    let namespace = moduleScript.namespace;
    return {
      namespace: namespace,
      staticImport: function(specifier){
        let u = new URL(specifier, url).toString();
        let moduleScript = registry.get(u);
        return moduleScript.namespace;
      },
      dynamicImport: function(specifier){
        let u = new URL(specifier, url).toString();
        return dynamicImport(u);
      },
      set: function(name, value) {
        if(typeof name === 'object') {
          let moduleTools = this;
          Object.keys(name).forEach(function(key){
            moduleTools.set(key, name[key]);
          });
          return;
        }
        moduleScript.values[name] = value;
        return value;
      }
    };
  };
}

// TODO saving this space in case I want to support multiple workers

var execute = function({ url, code, map }){
  if(map) {
    code += encode$1(map);
  } else {
    code += '\n//# sourceURL=' + url;
  }

   __scriptTypeModuleEval(code);
}

const prefix = '\n//# source' + 'MappingURL=data:application/json;base64,';

function encode$1(map) {
  return prefix + btoa(JSON.stringify(map));
}

class ModuleTree {
  constructor() {
    this.count = 0;
    this.fetchPromise = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    })
  }

  increment() {
    this.count++;
  }

  decrement() {
    this.count--;
    if(this.count === 0) {
      this.resolve();
    }
  }
}

class ModuleRecord {
  constructor() {
    this.requestedModules = null;
    this.instantiationStatus = 'uninstantiated';
  }
}

class ModuleScript {
  constructor(url, resolve, reject){
    this.moduleRecord = new ModuleRecord();
    this.status = 'fetching';
    this.baseTree = null;
    this.trees = new Set();
    this.url = url;
    this.resolve = resolve;
    this.reject = reject;
    this._instantiationPromise = null;

    this.fetchMessage = null;
    this.deps = null;
    this.code = null;

    this.values = {};
    this.namespace = {};
  }

  addToTree(tree) {
    if(!this.trees.has(tree)) {
      this.trees.add(tree);
      if(this.status === 'fetching') {
        tree.increment();
      }
      if(!this.baseTree) {
        this.baseTree = tree;
      }
    }
  }

  addMessage(msg) {
    this.status = 'fetched';
    this.fetchMessage = msg;
    this.code = msg.src;
    this.map = msg.map;
    this.deps = msg.deps;
  }

  complete() {
    this.resolve(this);
    this.trees.forEach(function(tree){
      tree.decrement();
    });
  }

  error(err) {
    this.reject(err);
  }

  isDepOf(moduleScript) {
    return moduleScript.deps.indexOf(this.url) !== -1;
  }

  instantiate() {
    try {
      execute(this);
      this.moduleRecord.instantiationStatus = 'instantiated';
    } catch(err) {
      this.moduleRecord.instantiationStatus = 'errored';
      this.moduleRecord.errorReason = err;
      throw err;
    }
  }

  instantiatePromise() {
    if(this._instantiationPromise) {
      return this._instantiationPromise;
    }
    return this._instantiationPromise = this._getInstantiatePromise();
  }

  _getInstantiatePromise() {
    switch(this.moduleRecord.instantiationStatus) {
      case 'instantiated':
        return Promise.resolve();
      case 'errored':
        return Promise.reject(this.moduleRecord.errorReason);
      default:
        let tree = this.baseTree;
        return tree.fetchPromise.then(() => {
          // Wait for it to execute
          return this._getInstantiatePromise();
        });
    }
  }
}

const forEach$1 = Array.prototype.forEach;

function importExisting(importScript){
  let tags = document.querySelectorAll('script[type=module-polyfill]');
  forEach$1.call(tags, importScript);
}

function observe(importScript) {
  let mo = new MutationObserver(function(mutations){
    forEach$1.call(mutations, function(mutation){
      forEach$1.call(mutation.addedNodes, function(el){
        if(el.nodeName === 'SCRIPT' && el.type === 'module-polyfill') {
          importScript(el);
        }
      });
    });
  });
  mo.observe(document.documentElement, {
    childList: true,
    subtree: true
  });

  return mo;
}

var Registry = class {
  constructor() {
    this.moduleScriptMap = new Map();
    this.fetchPromises = new Map();
  }

  get(url) {
    return this.moduleScriptMap.get(url);
  }

  add(moduleScript) {
    let url = moduleScript.url;
    this.moduleScriptMap.set(url, moduleScript);
  }

  addExports(moduleScript) {
    let msg = moduleScript.fetchMessage;
    let exports = msg.exports;
    let exportStars = msg.exportStars;

    Object.keys(exports).forEach(name => {
      let exp = exports[name];
      if(exp.from) {
        let parentModuleScript = this.moduleScriptMap.get(exp.from);

        Object.defineProperty(moduleScript.namespace, name, {
          get: getValue(parentModuleScript, exp.local)
        });
      } else {
        Object.defineProperty(moduleScript.namespace, name, {
          get: getValue(moduleScript, name)
        });
      }
    });

    exportStars.forEach(from => {
      let parentModuleScript = this.moduleScriptMap.get(from);
      let props = Object.getOwnPropertyNames(parentModuleScript.namespace);
      props.forEach(function(prop){
        Object.defineProperty(moduleScript.namespace, prop, {
          get: getValue(parentModuleScript, prop)
        });
      });
    });
  }

  link(moduleScript) {
    moduleScript.status = 'linking';

    let deps = moduleScript.deps;
    deps.forEach(depUrl => {
      let depModuleScript = this.get(depUrl);
      if(depModuleScript.moduleRecord.instantiationStatus === 'uninstantiated') {
        // Circular deps
        if(depModuleScript.status !== 'linking') {
          this.link(depModuleScript);
        }
      }
    });

    moduleScript.status = 'linked';
    this.instantiate(moduleScript);
  }

  instantiate(moduleScript) {
    if(moduleScript.moduleRecord.instantiationStatus === 'uninstantiated') {
      this.addExports(moduleScript);
      moduleScript.instantiate();
    }
  }
}

function getValue(moduleScript, name, par) {
  return function(){
    return moduleScript.values[name];
  };
}

let cluster = new Cluster(1);

let registry = new Registry();
let anonCount = 0;
let pollyScript = currentScript();
let includeSourceMaps = pollyScript.dataset.noSm == null;

addModuleTools(registry, dynamicImport);

function importScript(script) {
  let url = "" + (script.src || new URL('./!anonymous_' + anonCount++, document.baseURI));
  let src = script.src ? undefined : script.textContent;

  return internalImportModule(url, src)
  .then(function(){
    var ev = new Event('load');
    script.dispatchEvent(ev);
  })
  .then(null, function(err){
    console.error(err);
    var ev = new ErrorEvent('error', {
      message: err.message,
      filename: url
    });
    script.dispatchEvent(ev);
  });
}

function internalImportModule(url, src){
  let entry = registry.get(url);
  if(entry) {
    return entry.instantiatePromise();
  }
  return importModuleWithTree(url, src);
}

function importModuleWithTree(url, src){
  let tree = new ModuleTree();

  return fetchModule(url, src, tree)
  .then(function(moduleScript){
    return tree.fetchPromise.then(function(){
      return moduleScript;
    });
  })
  .then(function(moduleScript){
    registry.link(moduleScript);
  });


}

function fetchModule(url, src, tree) {
  var promise = registry.fetchPromises.get(url);
  if(!promise) {
    promise = new Promise(function(resolve, reject){
      let moduleScript = new ModuleScript(url, resolve, reject);
      moduleScript.addToTree(tree);
      let handler = function(msg){
        if(msg.type === 'error') {
          let ErrorConstructor = self[msg.error.name] || Error;
          let error = new ErrorConstructor(msg.error.message);
          moduleScript.error(error);
          return;
        }

        moduleScript.addMessage(msg);
        fetchTree(moduleScript, tree);
        moduleScript.complete();
      };
      cluster.post({
        type: 'fetch',
        url: url,
        src: src,
        includeSourceMaps: includeSourceMaps
      }, handler);
      registry.add(moduleScript);
    });
    registry.fetchPromises.set(url, promise);
  } else {
    // See if this ModuleScript is still being fetched
    let moduleScript = registry.get(url);
    moduleScript.addToTree(tree);
  }
  return promise;
}

function fetchTree(moduleScript, tree) {
  let deps = moduleScript.deps;
  let promises = deps.map(function(url){
    let fetchPromise = fetchModule(url, null, tree);
    let depModuleScript = registry.get(url);
    moduleScript.trees.forEach(function(tree){
      depModuleScript.addToTree(tree);
    });
    return fetchPromise;
  });
  return Promise.all(promises);
}

function dynamicImport(url, src){
  return internalImportModule(url, src).then(function(){
    return registry.get(url).namespace;
  });
}

importExisting(importScript);
observe(importScript);

}());
