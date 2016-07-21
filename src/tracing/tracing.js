import addElOrigin from "./addElOrigin"
import unstringTracifyArguments from "./unstringTracifyArguments"
import makeTraceObject from "./makeTraceObject"
import Origin from "../origin"
import _ from "underscore"
import stringTraceUseValue from "./stringTraceUseValue"
import {makeSureInitialHTMLHasBeenProcessed} from "./processElementsAvailableOnInitialLoad"
import processJavaScriptCode from "../compilation/processJavaScriptCode"
import mapInnerHTMLAssignment from "./mapInnerHTMLAssignment"

window.fromJSDynamicFiles = {}
window.fromJSDynamicFileOrigins = {}
var tracingEnabled = false;

var originalCreateElement = document.createElement
window.originalCreateElement = originalCreateElement

var appendChildPropertyDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, "appendChild");
window.originalAppendChildPropertyDescriptor = appendChildPropertyDescriptor

var nativeSetAttribute = Element.prototype.setAttribute;
window.nativeSetAttribute = nativeSetAttribute

var nativeClassNameDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "className");
window.nativeClassNameDescriptor = nativeClassNameDescriptor

var nativeInnerHTMLDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "innerHTML");
window.nativeInnerHTMLDescriptor = nativeInnerHTMLDescriptor;

var nativeExec = RegExp.prototype.exec;
window.nativeExec = nativeExec;

var nativeFunction = Function
window.nativeFunction = nativeFunction

var nativeJSONParse = JSON.parse
window.nativeJSONParse = nativeJSONParse

var nativeLocalStorage = window.localStorage;
window.originalLocalStorage = nativeLocalStorage

var nativeEval = window.eval

var nativeArrayJoin = Array.prototype.join
var nativeArrayIndexOf = Array.prototype.indexOf

var nativeNodeTextContentDescriptor = Object.getOwnPropertyDescriptor(Node.prototype, "textContent")

export function enableTracing(){
    if (tracingEnabled){
        return
    }
    tracingEnabled = true



    document.createElement = function(tagName){

        var el = originalCreateElement.call(this, tagName)
        addElOrigin(el, "openingTagStart", {
            action: "createElement",
            inputValues: [tagName],
            value: el.tagName
        })
        addElOrigin(el, "openingTagEnd", {
            action: "createElement",
            inputValues: [tagName],
            value: el.tagName
        })
        return el;
    }


    Object.defineProperty(Node.prototype, "appendChild", {
        get: function(){
            return function(appendedEl){
                addElOrigin(this, "appendChild",{
                    action: "appendChild",
                    stack: new Error().stack.split("\n"),
                    inputValues: [appendedEl],
                    valueOfEl: appendedEl,
                    child: appendedEl
                })

                return appendChildPropertyDescriptor.value.apply(this, arguments)
            }
        }
    })

    Element.prototype.setAttribute = function(attrName, value){
        addElOrigin(this, "attribute_" + attrName.toString(), {
            action: "setAttribute",
            inputValues: [attrName, value],
            value: "not gotten around to making this work yet"
        })
        return nativeSetAttribute.apply(this, arguments)
    }

    var nativeRemoveAttribute = Element.prototype.removeAttribute;
    Element.prototype.removeAttribute = function(attrName){
        addElOrigin(this, "attribute_" +attrName.toString(), {
            action: "removeAttribute",
            inputValues: [attrName],
            value: "whateverr"
        })
        return nativeRemoveAttribute.apply(this, arguments)
    }


    Object.defineProperty(Element.prototype, "className", {
        set: function(newValue){
            addElOrigin(this, "attribute_class", {
                action: "set className",
                value: " class='" + newValue.toString() + "'",
                inputValues: [newValue]
            })
            return nativeClassNameDescriptor.set.apply(this, arguments)
        },
        get: function(){
            return nativeClassNameDescriptor.get.apply(this, arguments)
        }
    })

    JSON.parse = function(str){
        var parsedVal = nativeJSONParse.apply(this, arguments)

        for (var key in parsedVal) {
            var value = parsedVal[key]
            if (_.isArray(value) || _.isObject(value)){
                parsedVal[key] = JSON.parse(JSON.stringify(value))
            } else if (typeof value === "string" ||
                typeof value === "boolean" ||
                typeof value === "number") {
                parsedVal[key] =  makeTraceObject(
                    {
                        value: parsedVal[key],
                        origin: new Origin({
                            value: parsedVal[key],
                            inputValues: [str],
                            inputValuesCharacterIndex: [str.toString().indexOf(parsedVal[key])], // not very accurate, but better than nothing/always using char 0
                            action: "JSON.parse",
                            actionDetails: key
                        })
                    }
                )
            } else {
                throw "no"
            }
        }

        return parsedVal
    }

    Array.prototype.join = function(separator){
        var stringifiedItems = this.map(function(item){
            return item.toString()
        })
        // .join already does stringification, but we may need to call .toString()
        // twice if there is an object with a toString function which returns
        // a FromJSString (an object) which needs to be converted to a native string
        return nativeArrayJoin.apply(stringifiedItems, [separator])
    }

    Array.prototype.indexOf = function(value){
        var arrayItems = this.map(stringTraceUseValue)
        return nativeArrayIndexOf.apply(arrayItems, arguments)
    }

    Object.defineProperty(Node.prototype, "textContent", {
        get: function(){
            return nativeNodeTextContentDescriptor.get.apply(this, arguments)
        },
        set: function(newTextContent){
            var ret = nativeNodeTextContentDescriptor.set.apply(this, arguments)
            var el = this;

            addElOrigin(el, "replaceContents", el.childNodes)
            if (newTextContent.toString() !== ""){
                var childNode = el.childNodes[0];
                el.__elOrigin.contents = [childNode]

                addElOrigin(childNode, "textValue", {
                    action: "Assign textContent",
                    inputValues: [newTextContent],
                    value: newTextContent.toString()
                })
            }

            return ret;
        }
    })

    Object.defineProperty(Element.prototype, "innerHTML", {
        set: function(innerHTML){
            makeSureInitialHTMLHasBeenProcessed();

            var ret = nativeInnerHTMLDescriptor.set.apply(this, arguments)
            mapInnerHTMLAssignment(this, innerHTML, "Assign InnerHTML")
            return ret
        },
        get: function(){
            makeSureInitialHTMLHasBeenProcessed()

            var innerHTML = nativeInnerHTMLDescriptor.get.apply(this, arguments)
            return makeTraceObject({
                value: innerHTML,
                origin: new Origin({
                    value: innerHTML,
                    action: "Read Element innerHTML",
                    inputValues: []
                })
            })
        }
    })


    Object.defineProperty(window, "localStorage", {
        get: function(){
            return new Proxy(nativeLocalStorage, {
                get: function(target, name){
                    if (name === "getItem") {
                        return function getItem(key){
                            var val = nativeLocalStorage.getItem.apply(target, arguments)
                            if (typeof val === "string"){
                                val = makeTraceObject({
                                    value: val,
                                    origin: new Origin({
                                        action: "localStorage.getItem",
                                        actionDetails: key,
                                        value: val,
                                        inputValues: [key]
                                    }),
                                })
                            }
                            return val;
                        }
                    }

                    var res = nativeLocalStorage[name]
                    var propertyValueIsLocalStorageData = nativeLocalStorage.hasOwnProperty(name)
                    if (propertyValueIsLocalStorageData){
                        res = makeTraceObject({
                            value: res,
                            origin: new Origin({
                                action: "localStorage.getItem",
                                actionDetails: name,
                                value: res,
                                inputValues: [name]
                            }),
                        })
                    }

                    if (typeof res === "function"){
                        return res.bind(target)
                    }
                    return res;
                }
            })
        }
    })

    window.eval = function(code){
        debugger
        var res = processJavaScriptCode(stringTraceUseValue(code), {filename: "test.js"})
        console.log(res)
        return nativeEval(res.code)
    }

    RegExp.prototype.exec = function(){
        var args = unstringTracifyArguments(arguments)
        return nativeExec.apply(this, args)
    }

    window.Function = function(code){
        var args = Array.prototype.slice.apply(arguments)
        var code = args.pop()
        var argsWithoutCode = args.slice()

        var id = _.uniqueId();
        var filename = "DynamicFunction" + id + ".js"
        var res = processJavaScriptCode(stringTraceUseValue(code), {filename: filename})
        args.push(res.code)


        var fnName = "DynamicFunction" + id
        var smFilename = filename + ".map"
        var evalCode = "function " + fnName + "(" + argsWithoutCode.join(",") + "){" + res.code + "}" +
            "\n//# sourceURL=" + filename +
            "\n//# sourceMappingURL=" + smFilename

        // create script tag instead of eval to prevent strict mode from propagating
        // (I'm guessing if you call eval from code that's in strict mode  strict mode will
        // propagate to the eval'd code.)
        var script = document.createElement("script")
        script.innerHTML = evalCode
        document.body.appendChild(script)

        script.remove();

        fromJSDynamicFiles[smFilename] = res.map
        fromJSDynamicFiles[filename] = evalCode
        fromJSDynamicFiles[filename + "?dontprocess=yes"] = code.value
        fromJSDynamicFileOrigins[filename + "?dontprocess=yes"] = new Origin({
            action: "Dynamic Script",
            value: code.value,
            inputValues: [code.origin]
        })

        return function(){
            return window[fnName].apply(this, arguments)
        }
    }
    window.Function.prototype = nativeFunction.prototype


    // try to add this once, but it turned out the .dataset[sth] assignment
    // was in a chrome extension that uses a different HTMLElement object
    window.nativeDataSetDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "dataset")
    // Object.defineProperty(HTMLElement.prototype, "dataset", {
    //     set: function(){
    //         return nativeDataSetDescriptor.set.apply(this, arguments)
    //     },
    //     get: function(){
    //         var nativeRes = nativeDataSetDescriptor.get.apply(this, arguments)
    //
    //         var proxy = new Proxy(nativeRes, {
    //             set: function(target, name, value){
    //                 nativeRes[name] = value
    //             }
    //         })
    //         return proxy;
    //     }
    // })

}


export function disableTracing(){
    if (!tracingEnabled) {
        return;
    }
    window.JSON.parse = window.nativeJSONParse
    document.createElement = window.originalCreateElement
    Object.defineProperty(Node.prototype, "appendChild", window.originalAppendChildPropertyDescriptor);
    Element.prototype.setAttribute = window.nativeSetAttribute
    Object.defineProperty(Element.prototype, "innerHTML", nativeInnerHTMLDescriptor)
    Object.defineProperty(window, "localStorage", {
        get: function(){
            return window.originalLocalStorage
        }
    })
    RegExp.prototype.exec = window.nativeExec
    window.Function = nativeFunction
    Object.defineProperty(Element.prototype, "className", window.nativeClassNameDescriptor)
    Object.defineProperty(HTMLElement.prototype, "dataset", window.nativeDataSetDescriptor)
    Object.defineProperty(Node.prototype, "textContent", nativeNodeTextContentDescriptor)
    Array.prototype.join = nativeArrayJoin
    Array.prototype.indexOf = nativeArrayIndexOf
    window.eval = nativeEval

    tracingEnabled = false;
}

window._disableTracing = disableTracing
