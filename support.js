// Lumio DC Runtime — support.js
//
// KEY FIX: The browser's HTML parser "foster-parents" unknown elements
// (like <sc-for>) out of table rows/bodies, destroying the template structure.
// We work around this by fetching the raw HTML source and parsing the <x-dc>
// block through a <template> element, which uses permissive content mode and
// does NOT apply foster-parenting — so <sc-for> stays inside <tr>/<tbody>.

(function () {

  // ─── React shim ─────────────────────────────────────────────────────────────
  window.React = {
    createElement: function (type, props) {
      var children = [];
      for (var i = 2; i < arguments.length; i++) {
        var c = arguments[i];
        if (Array.isArray(c)) { children = children.concat(c); }
        else { children.push(c); }
      }
      return { _dc: true, type: type, props: props || {}, children: children };
    }
  };

  // ─── VNode → real DOM ────────────────────────────────────────────────────────
  var SVG_NS   = 'http://www.w3.org/2000/svg';
  var SVG_TAGS = {
    svg:1,path:1,circle:1,rect:1,line:1,polyline:1,polygon:1,
    ellipse:1,g:1,text:1,defs:1,use:1,symbol:1,linearGradient:1,
    stop:1,clipPath:1,mask:1,tspan:1,textPath:1
  };
  var PROP_TO_ATTR = {
    strokeWidth:'stroke-width', strokeLinecap:'stroke-linecap',
    strokeLinejoin:'stroke-linejoin', strokeDasharray:'stroke-dasharray',
    strokeDashoffset:'stroke-dashoffset', fillOpacity:'fill-opacity',
    className:'class', viewBox:'viewBox'
  };

  function vnodeToDom(v, isSvg) {
    if (v === null || v === undefined || v === false) return null;
    if (Array.isArray(v)) {
      var f = document.createDocumentFragment();
      v.forEach(function (c) { var n = vnodeToDom(c, isSvg); if (n) f.appendChild(n); });
      return f;
    }
    if (typeof v !== 'object' || !v._dc) return document.createTextNode(String(v));

    var svg = isSvg || !!SVG_TAGS[v.type];
    var el  = svg ? document.createElementNS(SVG_NS, v.type) : document.createElement(v.type);

    var UNITLESS_CSS = {opacity:1,flex:1,flexGrow:1,flexShrink:1,fontWeight:1,lineHeight:1,zIndex:1,zoom:1,order:1,strokeOpacity:1,fillOpacity:1};
    Object.keys(v.props || {}).forEach(function (k) {
      if (k === 'key' || k === 'children') return;
      var val = v.props[k];
      if (val === null || val === undefined) return;
      if (PROP_TO_ATTR[k]) { el.setAttribute(PROP_TO_ATTR[k], String(val)); return; }
      if (/^on[A-Z]/.test(k) && typeof val === 'function') {
        el.addEventListener(k.slice(2).toLowerCase(), val); return;
      }
      // Serialize React-style style objects to CSS strings
      if (k === 'style' && typeof val === 'object' && !Array.isArray(val)) {
        el.style.cssText = Object.keys(val).map(function (p) {
          var cssProp = p.replace(/([A-Z])/g, function (_, c) { return '-' + c.toLowerCase(); });
          var cssVal  = val[p];
          if (typeof cssVal === 'number' && !UNITLESS_CSS[p]) cssVal = cssVal + 'px';
          return cssProp + ':' + cssVal;
        }).join(';');
        return;
      }
      el.setAttribute(k, String(val));
    });

    v.children.forEach(function (c) {
      if (c === null || c === undefined || c === false) return;
      var n = vnodeToDom(c, svg);
      if (n) el.appendChild(n);
    });
    return el;
  }

  // ─── Expression evaluator ────────────────────────────────────────────────────
  function evalExpr(expr, scope) {
    try {
      return (new Function('__s', 'with(__s){return(' + expr.trim() + ')}')).call(null, scope);
    } catch (e) { return undefined; }
  }

  function interpolate(str, scope) {
    if (typeof str !== 'string' || str.indexOf('{{') === -1) return str;
    var parts = [], rest = str;
    while (rest.length > 0) {
      var s = rest.indexOf('{{');
      if (s === -1) { if (rest) parts.push(rest); break; }
      if (s > 0) parts.push(rest.slice(0, s));
      var e = rest.indexOf('}}', s + 2);
      if (e === -1) { parts.push(rest); break; }
      parts.push(evalExpr(rest.slice(s + 2, e), scope));
      rest = rest.slice(e + 2);
    }
    var hasObj = parts.some(function (p) {
      return p !== null && p !== undefined && typeof p === 'object';
    });
    if (!hasObj) {
      return parts.map(function (p) { return (p === null || p === undefined) ? '' : String(p); }).join('');
    }
    return parts;
  }

  // ─── Template renderer ───────────────────────────────────────────────────────
  function toCamel(s) { return s.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); }); }

  function renderNodes(nodes, scope, container, isSvg) {
    nodes.forEach(function (n) { renderNode(n, scope, container, isSvg); });
  }

  function renderNode(node, scope, container, isSvg) {

    // Text node
    if (node.nodeType === 3) {
      var txt = node.textContent;
      if (txt.indexOf('{{') === -1) { container.appendChild(document.createTextNode(txt)); return; }
      var res = interpolate(txt, scope);
      if (!Array.isArray(res)) { container.appendChild(document.createTextNode(res || '')); return; }
      res.forEach(function (part) {
        if (part === null || part === undefined) return;
        if (typeof part === 'object') {
          var n = vnodeToDom(part, isSvg || !!(part._dc && SVG_TAGS[part.type]));
          if (n) container.appendChild(n);
        } else { container.appendChild(document.createTextNode(String(part))); }
      });
      return;
    }

    if (node.nodeType !== 1) return;
    var tag = node.tagName.toLowerCase();

    // <helmet> already handled in boot() — skip during render
    if (tag === 'helmet') return;

    // <sc-for list="{{ expr }}" as="varName">
    if (tag === 'sc-for') {
      var listRaw = (node.getAttribute('list') || '').trim();
      var listExpr = listRaw.startsWith('{{') && listRaw.endsWith('}}')
        ? listRaw.slice(2, -2).trim() : listRaw;
      var asName = node.getAttribute('as') || 'item';
      var list = evalExpr(listExpr, scope);
      if (!Array.isArray(list)) return;
      var kids = Array.from(node.childNodes);
      list.forEach(function (item, idx) {
        var inner = Object.assign({}, scope);
        inner[asName] = item;
        inner[asName + 'Index'] = idx;
        renderNodes(kids, inner, container, isSvg);
      });
      return;
    }

    // <sc-if value="{{ expr }}">
    if (tag === 'sc-if') {
      var valRaw = (node.getAttribute('value') || '').trim();
      var valExpr = valRaw.startsWith('{{') && valRaw.endsWith('}}')
        ? valRaw.slice(2, -2).trim() : valRaw;
      if (evalExpr(valExpr, scope)) renderNodes(Array.from(node.childNodes), scope, container, isSvg);
      return;
    }

    // <dc-import name="..." prop="{{ val }}">
    if (tag === 'dc-import') {
      var name = node.getAttribute('name');
      var hint = node.getAttribute('hint-size') || '';
      var sp   = hint.split(',');
      var wrap = document.createElement('div');
      if (sp[0]) wrap.style.width  = sp[0].trim();
      if (sp[1]) wrap.style.height = sp[1].trim();
      container.appendChild(wrap);
      var props = {};
      Array.from(node.attributes).forEach(function (a) {
        if (a.name === 'name' || a.name.startsWith('hint-')) return;
        var pn = toCamel(a.name), v = a.value;
        props[pn] = (v.startsWith('{{') && v.endsWith('}}'))
          ? evalExpr(v.slice(2, -2).trim(), scope) : v;
      });
      loadComponent(name, props, wrap);
      return;
    }

    // Regular element
    var svg = isSvg || !!SVG_TAGS[tag];
    var el  = svg ? document.createElementNS(SVG_NS, tag) : document.createElement(tag);
    var hoverStyle = null, baseStyle = '';

    Array.from(node.attributes).forEach(function (a) {
      var an = a.name, av = a.value;
      if (an.startsWith('hint-')) return;
      if (an === 'style-hover') { hoverStyle = av; return; }

      if (/^on[A-Za-z]/.test(an)) {
        var raw = av.trim();
        var expr = (raw.startsWith('{{') && raw.endsWith('}}')) ? raw.slice(2, -2).trim() : raw;
        var fn = evalExpr(expr, scope);
        if (typeof fn === 'function') el.addEventListener(an.slice(2).toLowerCase(), fn);
        return;
      }

      var interp = interpolate(av, scope);
      var str;
      if (Array.isArray(interp)) {
        str = interp.map(function (p) {
          return (p === null || p === undefined || typeof p === 'object') ? '' : String(p);
        }).join('');
      } else {
        str = (interp === null || interp === undefined) ? '' : String(interp);
      }

      if (an === 'value') {
        // Always set value attribute (even empty string) — an empty value="" on <option>
        // is meaningful: it marks the "show all" option, and dropping it makes
        // e.target.value return the option text instead of "".
        el.setAttribute('value', str); el.value = str; return;
      }
      if (str !== '') el.setAttribute(an, str);
      if (an === 'style') baseStyle = str;
    });

    if (hoverStyle !== null) {
      var bs = baseStyle, hs = hoverStyle;
      el.addEventListener('mouseenter', function () {
        el.style.cssText = bs;
        hs.split(';').forEach(function (rule) {
          var ci = rule.indexOf(':');
          if (ci > 0) el.style[rule.slice(0, ci).trim()] = rule.slice(ci + 1).trim();
        });
      });
      el.addEventListener('mouseleave', function () { el.style.cssText = bs; });
    }

    renderNodes(Array.from(node.childNodes), scope, el, svg);
    if (tag === 'textarea') el.value = el.textContent;
    // Set select value AFTER options are rendered (setting it before has no effect)
    if (tag === 'select' && el.hasAttribute('value')) {
      el.value = el.getAttribute('value');
    }
    container.appendChild(el);
  }

  // ─── Sub-component loader ────────────────────────────────────────────────────
  // Parses the raw HTML with a <template> element (no foster-parenting) so that
  // <sc-for> inside <tbody> is not moved out by the HTML parser.
  var _htmlCache = {};

  function loadComponent(name, props, container) {
    var url = './' + name + '.dc.html';

    function doRender(html) {
      // Extract raw <x-dc>...</x-dc> text and parse via <template>
      var s = html.indexOf('<x-dc>'), e = html.indexOf('</x-dc>');
      if (s === -1 || e === -1) return;
      var xdcText = html.slice(s + 6, e);

      var tpl = document.createElement('template');
      tpl.innerHTML = xdcText;

      // Extract and eval the component script via regex (parser-independent)
      var scriptMatch = html.match(
        /<script[^>]+type="text\/x-dc"[^>]+data-dc-script[^>]*>([\s\S]*?)<\/script>/
      );
      if (!scriptMatch) return;

      var Cls = evalScript(scriptMatch[1]);
      if (!Cls) return;

      var inst = new Cls(props);
      var vals = inst.renderVals() || {};
      renderNodes(Array.from(tpl.content.childNodes), Object.assign({}, vals, props), container, false);
    }

    if (_htmlCache[name]) { doRender(_htmlCache[name]); return; }
    fetch(url)
      .then(function (r) { return r.text(); })
      .then(function (html) {
        _htmlCache[name] = html;
        doRender(html);
        document.dispatchEvent(new CustomEvent('dc:rerender'));
      })
      .catch(function (err) { console.error('[dc-import] failed to load', name, err); });
  }

  // ─── Component script evaluator ──────────────────────────────────────────────
  function evalScript(src) {
    try {
      return (new Function('DCLogic', 'React', src + '\nreturn Component;'))(
        window.DCLogic, window.React
      );
    } catch (e) { console.error('[dc] evalScript error:', e); return null; }
  }

  // ─── DCLogic base class ───────────────────────────────────────────────────────
  class DCLogic {
    constructor(props) {
      this.props = props || {};
      this.state = {};
      this._container = null;
      this._tplNodes  = null;
      this._pending   = false;
    }

    setState(updates) {
      var prev = Object.assign({}, this.state);
      Object.assign(this.state, updates);
      if (this._pending) return;
      this._pending = true;
      var self = this;
      Promise.resolve().then(function () {
        self._pending = false;
        if (!self._container || !self._tplNodes) return;

        // Preserve focus across re-renders so typing isn't interrupted
        var ae = document.activeElement;
        var focusSave = null;
        if (ae && self._container.contains(ae) &&
            (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
          focusSave = { tag: ae.tagName.toLowerCase(), type: ae.getAttribute('type') || '',
                        ss: ae.selectionStart, se: ae.selectionEnd };
        }

        // Save textarea values by ID before wiping — restored after re-render
        var savedTaValues = {};
        Array.from(self._container.querySelectorAll('textarea[id]')).forEach(function(ta) {
          savedTaValues[ta.id] = ta.value;
        });

        // Save all form fields: [data-f] = property form, [data-bf] = booking form
        var savedFieldValues = null;
        var fieldEls = Array.from(self._container.querySelectorAll('[data-f],[data-bf]'));
        if (fieldEls.length > 0) {
          savedFieldValues = {};
          fieldEls.forEach(function(el) {
            var attr = el.hasAttribute('data-f') ? 'data-f' : 'data-bf';
            var key  = attr + '=' + el.getAttribute(attr);
            savedFieldValues[key] = el.type === 'checkbox' ? el.checked : el.value;
          });
        }

        self._container.innerHTML = '';
        var vals = self.renderVals() || {};
        renderNodes(self._tplNodes, vals, self._container, false);

        // Restore textarea values (renderNode resets textarea value to its textContent)
        Object.keys(savedTaValues).forEach(function(id) {
          var ta = document.getElementById(id);
          if (ta) ta.value = savedTaValues[id];
        });

        // Restore form fields: key is "data-f=title" or "data-bf=status"
        if (savedFieldValues) {
          Object.keys(savedFieldValues).forEach(function(key) {
            var selector = '[' + key.replace('=', '="') + '"]';
            Array.from(self._container.querySelectorAll(selector)).forEach(function(el) {
              if (el.type === 'checkbox') el.checked = savedFieldValues[key];
              else el.value = savedFieldValues[key];
            });
          });
        }

        if (focusSave) {
          var sel = focusSave.tag + (focusSave.type ? '[type="' + focusSave.type + '"]' : '');
          var target = self._container.querySelector(sel) ||
                       self._container.querySelector(focusSave.tag);
          if (target) {
            target.focus();
            try {
              if (typeof target.selectionStart === 'number')
                target.setSelectionRange(focusSave.ss, focusSave.se);
            } catch (e) { /* date/number inputs don't support selectionRange */ }
          }
        }

        self.componentDidUpdate(self.props, prev);
        document.dispatchEvent(new CustomEvent('dc:rerender'));
      });
    }

    renderVals()                          { return {}; }
    componentDidMount()                   {}
    componentDidUpdate(prevProps, prev)   {}
  }
  window.DCLogic = DCLogic;

  // ─── Bootstrap ───────────────────────────────────────────────────────────────
  function boot() {
    // Fetch the raw HTML source so we can parse <x-dc> with a <template> element.
    // This prevents the browser's foster-parenting algorithm from moving <sc-for>
    // out of <tr>/<tbody> during normal HTML parsing.
    fetch(location.href)
      .then(function (r) { return r.text(); })
      .then(function (rawHtml) {
        var s = rawHtml.indexOf('<x-dc>'), e = rawHtml.indexOf('</x-dc>');
        if (s === -1 || e === -1) { console.error('[dc] <x-dc> not found'); return; }

        var tpl = document.createElement('template');
        tpl.innerHTML = rawHtml.slice(s + 6, e);

        // Move <helmet> contents (fonts, keyframes) into <head> so they survive re-renders
        var helmet = tpl.content.querySelector('helmet');
        if (helmet) {
          Array.from(helmet.childNodes).forEach(function (child) {
            if (child.nodeType === 1) document.head.appendChild(child.cloneNode(true));
          });
        }

        var tplNodes = Array.from(tpl.content.childNodes);

        // Get component script from the live DOM (not affected by foster-parenting)
        var scriptEl = document.querySelector('script[type="text/x-dc"][data-dc-script]');
        if (!scriptEl) { console.error('[dc] No data-dc-script found'); return; }

        var Cls = evalScript(scriptEl.textContent);
        if (!Cls) return;

        var xdc = document.querySelector('x-dc');
        xdc.innerHTML = '';

        var inst = new Cls({});
        inst._container = xdc;
        inst._tplNodes  = tplNodes;

        // Initial render
        var vals = inst.renderVals() || {};
        renderNodes(tplNodes, vals, xdc, false);
        inst.componentDidMount();
        document.dispatchEvent(new CustomEvent('dc:rerender'));
      })
      .catch(function (err) { console.error('[dc] boot fetch failed:', err); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})();
