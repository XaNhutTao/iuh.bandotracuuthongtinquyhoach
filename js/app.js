/**
 * WebGIS Tra cứu Quy hoạch – Xã Nhựt Tảo
 * Giao diện kiểu sidebar trái + toolbar phải (xanh da trời)
 */
(function () {
  "use strict";

  var CFG = window.APP_CONFIG;
  var F = CFG.FIELDS;
  var currentTab = "tothua";
  var lastInfoText = "";
  var lastCenterLonLat = null;

  function $(sel, ctx) {
    return (ctx || document).querySelector(sel);
  }
  function $$(sel, ctx) {
    return Array.prototype.slice.call((ctx || document).querySelectorAll(sel));
  }

  function maskName(name) {
    if (!CFG.CHE_TEN_CHU_SU_DUNG || !name) return name || "";
    return String(name)
      .trim()
      .split(/\s+/)
      .map(function (p) {
        return p.length <= 1 ? p : p[0] + "***";
      })
      .join(" ");
  }

  function formatNumber(n, unit) {
    if (n === null || n === undefined || n === "") return "—";
    var num = Number(n);
    if (isNaN(num)) return String(n);
    var s = num.toLocaleString("vi-VN", { maximumFractionDigits: 1 });
    return unit ? s + " " + unit : s;
  }

  function showToast(msg, ms) {
    var el = $("#toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(showToast._t);
    showToast._t = setTimeout(function () {
      el.classList.remove("show");
    }, ms || 2800);
  }

  // ---------- map ----------
  var map, parcelLayer, parcelSource, planningLayer;
  var selectedFeature = null;
  var hoverFeature = null;
  var measureDraw = null;
  var measureSource = null;
  var measureLayer = null;
  var measureType = null;
  var measureListener = null;
  var gpsMarker = null;
  var labelOverlay = null;
  var baseLayers = {};
  var ownerIndex = null;
  var parcelIndex = null;
  var hiddenSheets = {};
  var sheetStats = []; // [{id, count}]

  function initMap() {
    baseLayers.satellite = new ol.layer.Tile({
      visible: true,
      source: new ol.source.XYZ({
        url: "https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}",
        attributions: "Google"
      })
    });
    // Bản đồ đường phố (thay nền tối)
    baseLayers.street = new ol.layer.Tile({
      visible: false,
      source: new ol.source.XYZ({
        url: "https://mt1.google.com/vt/lyrs=m&x={x}&y={y}&z={z}",
        attributions: "Google"
      })
    });
    // Địa hình (thay nền sáng)
    baseLayers.terrain = new ol.layer.Tile({
      visible: false,
      source: new ol.source.XYZ({
        url: "https://mt1.google.com/vt/lyrs=p&x={x}&y={y}&z={z}",
        attributions: "Google"
      })
    });

    var format = new ol.format.GeoJSON();
    var features = format.readFeatures(json_Aggregated_1, {
      dataProjection: "EPSG:4326",
      featureProjection: "EPSG:3857"
    });
    parcelSource = new ol.source.Vector({ features: features });

    // Lớp quy hoạch riêng từ VungNhutTao (polygon quy hoạch)
    var planningFeatures = [];
    if (typeof json_VungNhutTao_2 !== "undefined") {
      planningFeatures = format.readFeatures(json_VungNhutTao_2, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857"
      });
    }
    var planningSource = new ol.source.Vector({ features: planningFeatures });

    function isSheetVisible(feature) {
      var s = feature.get(F.soTo);
      if (s === null || s === undefined || String(s).trim() === "") return true;
      return !hiddenSheets[String(s)];
    }
    function styleParcelFiltered(feature, resolution) {
      if (!isSheetVisible(feature)) return null;
      return styleAggregated(feature, resolution);
    }

    parcelLayer = new ol.layer.Vector({
      source: parcelSource,
      style: styleParcelFiltered,
      opacity: 0.85,
      declutter: false
    });

    // Lớp quy hoạch (VungNhutTao) — nằm trên lớp thửa
    planningLayer = new ol.layer.Vector({
      source: planningSource,
      style: stylePlanning,
      opacity: 0.55,
      visible: true,
      declutter: false
    });

    measureSource = new ol.source.Vector();
    measureLayer = new ol.layer.Vector({
      source: measureSource,
      style: new ol.style.Style({
        fill: new ol.style.Fill({ color: "rgba(59,184,224,0.2)" }),
        stroke: new ol.style.Stroke({
          color: "#1a9fd1",
          width: 2,
          lineDash: [8, 6]
        }),
        image: new ol.style.Circle({
          radius: 5,
          fill: new ol.style.Fill({ color: "#1a9fd1" }),
          stroke: new ol.style.Stroke({ color: "#fff", width: 1.5 })
        })
      })
    });

    map = new ol.Map({
      target: "map",
      layers: [
        baseLayers.satellite,
        baseLayers.street,
        baseLayers.terrain,
        parcelLayer,
        planningLayer,
        measureLayer
      ],
      view: new ol.View({
        center: ol.proj.fromLonLat([CFG.TAM_BAN_DO[1], CFG.TAM_BAN_DO[0]]),
        zoom: CFG.ZOOM_MAC_DINH,
        maxZoom: 20,
        minZoom: 10
      }),
      controls: ol.control.defaults.defaults({
        zoom: false,
        attribution: true,
        rotate: false
      }).extend([new ol.control.ScaleLine({ units: "metric" })])
    });

    map.on("pointermove", onPointerMove);
    map.on("singleclick", onMapClick);

    var loading = $("#loading");
    if (loading) loading.style.display = "none";

    buildOwnerIndex();
  }

  function clearHover() {
    if (hoverFeature) {
      hoverFeature.set("_hover", false);
      hoverFeature = null;
    }
  }

  function clearSelect() {
    if (selectedFeature) {
      selectedFeature.set("_selected", false);
      selectedFeature = null;
    }
    if (labelOverlay) {
      map.removeOverlay(labelOverlay);
      labelOverlay = null;
    }
    $("#empty-state").style.display = "";
    $("#info-content").classList.remove("visible");
    $("#btn-copy").disabled = true;
    $("#btn-direction").disabled = true;
    lastInfoText = "";
    lastCenterLonLat = null;
  }

  function selectFeature(feature) {
    clearSelect();
    clearHover();
    selectedFeature = feature;
    feature.set("_selected", true);
    showInfo(feature);

    var geom = feature.getGeometry();
    if (!geom) return;
    var extent = geom.getExtent();
    var center = ol.extent.getCenter(extent);
    lastCenterLonLat = ol.proj.toLonLat(center);

    // Label overlay
    var soTo = feature.get(F.soTo) || "";
    var soThua = feature.get(F.soThua) || "";
    var el = document.createElement("div");
    el.style.cssText =
      "background:rgba(15,23,42,0.9);color:#fff;padding:4px 10px;border-radius:999px;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.25);pointer-events:none;";
    el.textContent = "Tờ " + soTo + " · Thửa " + soThua;
    labelOverlay = new ol.Overlay({
      element: el,
      positioning: "center-center",
      position: center,
      stopEvent: false
    });
    map.addOverlay(labelOverlay);

    map.getView().fit(extent, {
      padding: [60, 60, 60, 380],
      maxZoom: 18,
      duration: CFG.BAY_DEN_THUA_MUOT ? 500 : 0
    });
  }

  function updateCoordHud(lonLat, feature) {
    var el = $("#coord-hud");
    if (!el) return;
    if (!lonLat) {
      el.classList.remove("visible");
      el.innerHTML = "";
      return;
    }
    var lon = lonLat[0].toFixed(6);
    var lat = lonLat[1].toFixed(6);
    var extra = "";
    if (feature) {
      var st = feature.get(F.soTo);
      var sth = feature.get(F.soThua);
      if (st != null && sth != null) {
        extra = "<span>Tờ " + st + " · Thửa " + sth + "</span>";
      }
    }
    el.innerHTML =
      extra +
      "<strong>X " +
      lon +
      " · Y " +
      lat +
      "</strong>";
    el.classList.add("visible");
  }

  function onPointerMove(evt) {
    if (evt.dragging) return;
    var pixel = map.getEventPixel(evt.originalEvent);
    var feature = null;
    if (!measureType) {
      var hit = map.hasFeatureAtPixel(pixel, {
        layerFilter: function (l) {
          return l === parcelLayer;
        }
      });
      map.getTargetElement().style.cursor = hit ? "pointer" : "";

      feature = map.forEachFeatureAtPixel(
        pixel,
        function (f) {
          return f;
        },
        {
          layerFilter: function (l) {
            return l === parcelLayer;
          }
        }
      );
      if (feature !== hoverFeature) {
        clearHover();
        if (feature && feature !== selectedFeature) {
          hoverFeature = feature;
          feature.set("_hover", true);
        }
      }
    }

    // Tọa độ góc dưới phải khi rê trên thửa
    if (feature) {
      var lonLat = ol.proj.toLonLat(evt.coordinate);
      updateCoordHud(lonLat, feature);
    } else {
      updateCoordHud(null, null);
    }
  }

  function closeFloatingTools() {
    var pop = $("#layer-popover");
    if (pop) pop.classList.remove("open");
    var btn = $("#btn-layers");
    if (btn) btn.classList.remove("active");
    // Đóng gợi ý tìm kiếm
    var st = $("#suggest-tothua");
    var so = $("#suggest-owner");
    if (st) st.innerHTML = "";
    if (so) so.innerHTML = "";
  }

  function onMapClick(evt) {
    closeFloatingTools();
    if (measureType) return;
    var feature = map.forEachFeatureAtPixel(
      evt.pixel,
      function (f) {
        return f;
      },
      {
        layerFilter: function (l) {
          return l === parcelLayer;
        }
      }
    );
    if (feature) selectFeature(feature);
    else clearSelect();
  }

  // ---------- info panel ----------
  function getProp(feature, key) {
    if (!key) return null;
    return feature.get(key);
  }

  function isEmpty(value) {
    return (
      value === null ||
      value === undefined ||
      value === "" ||
      String(value) === "None" ||
      String(value) === "null"
    );
  }

  function addRow(parent, label, value) {
    var row = document.createElement("div");
    row.className = "info-row";
    var l = document.createElement("span");
    l.className = "label";
    l.textContent = label;
    var v = document.createElement("span");
    v.className = "value";
    if (isEmpty(value)) {
      v.textContent = "_";
      v.style.opacity = "0.7";
    } else {
      v.textContent = String(value);
    }
    row.appendChild(l);
    row.appendChild(v);
    parent.appendChild(row);
  }

  function showInfo(feature) {
    var blockThua = $("#block-thua");
    var blockRatio = $("#block-ratio");
    var blockQh = $("#block-qh");
    blockThua.innerHTML = "";
    blockRatio.innerHTML = "";
    blockQh.innerHTML = "";

    var h3 = document.createElement("h3");
    h3.textContent = "Thửa đất";
    blockThua.appendChild(h3);

    var soTo = getProp(feature, F.soTo);
    var soThua = getProp(feature, F.soThua);
    var maThua = getProp(feature, F.maThua);
    var dt = getProp(feature, F.dienTich);
    var ht = getProp(feature, F.hienTrang);
    var chu = maskName(getProp(feature, F.chuSuDung));
    var diaChi = getProp(feature, F.diaChi);

    addRow(blockThua, "Số tờ", soTo);
    addRow(blockThua, "Số thửa", soThua);
    addRow(blockThua, "Mã thửa", maThua);
    addRow(blockThua, "Diện tích", formatNumber(dt, "m²"));
    // Bỏ mã đất trong ngoặc ở cuối (ví dụ " (NTS)")
    var htDisplay = ht;
    if (htDisplay !== null && htDisplay !== undefined) {
      htDisplay = String(htDisplay).replace(/\s*\([A-Z0-9+]+\)\s*$/i, "").trim();
    }
    addRow(blockThua, "Hiện trạng", htDisplay);
    addRow(blockThua, "Chủ sử dụng", chu);
    addRow(blockThua, "Địa chỉ", diaChi);

    // Quy hoạch: chỉ coi là có QH khi có TÊN loại đất quy hoạch (LoaidatQH)
    // Không có tên / null → "Nằm ngoài quy hoạch"
    var madat = getProp(feature, F.maLoaiDatQH);
    var tenQH = getProp(feature, F.tenLoaiDatQH);
    function isBlank(v) {
      return (
        v === null ||
        v === undefined ||
        String(v).trim() === "" ||
        String(v) === "None" ||
        String(v) === "null"
      );
    }
    var hasQH = !isBlank(tenQH);

    var dtqhRaw = Number(getProp(feature, F.dienTichQH)) || 0;
    var dtqh = hasQH ? dtqhRaw : 0;

    // Ẩn khối tỷ lệ %
    if (blockRatio) {
      blockRatio.style.display = "none";
      blockRatio.innerHTML = "";
    }

    var h3q = document.createElement("h3");
    h3q.textContent = "Chi tiết quy hoạch";
    blockQh.appendChild(h3q);

    if (hasQH) {
      var card = document.createElement("div");
      card.className = "qh-card";
      var sw = document.createElement("div");
      sw.className = "qh-swatch";
      var nm = document.createElement("div");
      nm.className = "qh-name";
      nm.textContent = isEmpty(tenQH) ? "_" : tenQH;
      var ar = document.createElement("div");
      ar.className = "qh-area";
      ar.textContent = formatNumber(dtqh, "m²");
      card.appendChild(sw);
      card.appendChild(nm);
      card.appendChild(ar);
      blockQh.appendChild(card);
    } else {
      var out = document.createElement("div");
      out.className = "qh-outside";
      out.textContent = "Nằm ngoài quy hoạch";
      blockQh.appendChild(out);
    }

    // Copy text
    function copyVal(val) {
      return isEmpty(val) ? "_" : String(val);
    }
    lastInfoText = [
      "Tờ: " + copyVal(soTo),
      "Thửa: " + copyVal(soThua),
      "Mã thửa: " + copyVal(maThua),
      "Diện tích: " + formatNumber(dt, "m²"),
      "Hiện trạng: " + copyVal(typeof htDisplay !== "undefined" ? htDisplay : ht),
      "Chủ sử dụng: " + copyVal(chu),
      "Địa chỉ: " + copyVal(diaChi),
      hasQH
        ? "Loại đất QH: " + copyVal(tenQH) + " · DTQH: " + formatNumber(dtqh, "m²")
        : "Quy hoạch: Nằm ngoài quy hoạch"
    ].join("\n");

    $("#empty-state").style.display = "none";
    $("#info-content").classList.add("visible");
    $("#btn-copy").disabled = false;
    $("#btn-direction").disabled = !lastCenterLonLat;
  }

  // ---------- search ----------
  function buildOwnerIndex() {
    ownerIndex = [];
    parcelIndex = [];
    var feats = parcelSource.getFeatures();
    var counts = {};
    for (var i = 0; i < feats.length; i++) {
      var f = feats[i];
      var n = f.get(F.chuSuDung);
      if (n) ownerIndex.push({ name: String(n), feature: f });
      var st = f.get(F.soTo);
      var sth = f.get(F.soThua);
      if (st != null && sth != null) {
        parcelIndex.push({
          key: String(st) + "_" + String(sth),
          label: "Tờ " + st + " · Thửa " + sth,
          feature: f
        });
      }
      if (st != null && st !== undefined && String(st).trim() !== "") {
        var sid = String(st);
        counts[sid] = (counts[sid] || 0) + 1;
      }
    }
    sheetStats = Object.keys(counts)
      .map(function (id) {
        return { id: id, count: counts[id] };
      })
      .sort(function (a, b) {
        var na = parseInt(a.id, 10);
        var nb = parseInt(b.id, 10);
        if (!isNaN(na) && !isNaN(nb)) return na - nb;
        return String(a.id).localeCompare(String(b.id));
      });
    renderSheetList("");
  }

  function refreshLayers() {
    if (parcelLayer) parcelLayer.changed();
    if (planningLayer) planningLayer.changed();
  }

  function renderSheetList(filter) {
    var box = $("#sheet-list");
    if (!box) return;
    box.innerHTML = "";
    var q = (filter || "").trim().toLowerCase();
    for (var i = 0; i < sheetStats.length; i++) {
      var item = sheetStats[i];
      if (q && String(item.id).toLowerCase().indexOf(q) === -1) continue;
      var lab = document.createElement("label");
      lab.className = "sheet-item";
      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !hiddenSheets[item.id];
      cb.dataset.sheet = item.id;
      cb.addEventListener("change", function () {
        var id = this.dataset.sheet;
        if (this.checked) delete hiddenSheets[id];
        else hiddenSheets[id] = true;
        refreshLayers();
      });
      var txt = document.createElement("span");
      txt.textContent = "Tờ " + item.id;
      var cnt = document.createElement("span");
      cnt.className = "cnt";
      cnt.textContent = item.count + " thửa";
      lab.appendChild(cb);
      lab.appendChild(txt);
      lab.appendChild(cnt);
      box.appendChild(lab);
    }
    if (!box.children.length) {
      box.innerHTML = '<div style="padding:8px;font-size:12px;color:#5a8a9e;text-align:center">Không có tờ phù hợp</div>';
    }
  }

  function onToThuaInput() {
    var q = $("#inp-tothua").value.trim().replace(/\s+/g, "").toLowerCase();
    var list = $("#suggest-tothua");
    if (list) list.innerHTML = "";
    var ownerList = $("#suggest-owner");
    if (ownerList) ownerList.innerHTML = "";
    if (q.length < 1 || !parcelIndex) return;
    var count = 0;
    for (var i = 0; i < parcelIndex.length && count < 15; i++) {
      var item = parcelIndex[i];
      if (item.key.indexOf(q) === 0 || item.key.replace("_", "").indexOf(q.replace(/[_\-\/.,]/g, "")) === 0) {
        var div = document.createElement("div");
        div.className = "suggest-item";
        div.textContent = item.label;
        var chu = item.feature.get(F.chuSuDung);
        if (chu) {
          var sm = document.createElement("small");
          sm.textContent = String(chu);
          div.appendChild(sm);
        }
        (function (feat, key) {
          div.addEventListener("click", function () {
            selectFeature(feat);
            list.innerHTML = "";
            $("#inp-tothua").value = key;
          });
        })(item.feature, item.key);
        list.appendChild(div);
        count++;
      }
    }
  }

  function searchToThua() {
    var raw = $("#inp-tothua").value.trim().replace(/\s+/g, "");
    if (!raw) {
      showToast("Vui lòng nhập số tờ_số thửa");
      return;
    }
    var parts = raw.split(/[_\-\/.,]/);
    if (parts.length < 2 || !/^\d+$/.test(parts[0]) || !/^\d+$/.test(parts[1])) {
      showToast("Định dạng: số tờ_số thửa (vd: 10_75)");
      return;
    }
    var soTo = parts[0];
    var soThua = parts[1];
    var feats = parcelSource.getFeatures();
    for (var i = 0; i < feats.length; i++) {
      var f = feats[i];
      if (String(f.get(F.soTo)) === soTo && String(f.get(F.soThua)) === soThua) {
        selectFeature(f);
        showToast("Đã tìm thấy thửa " + soTo + "/" + soThua);
        return;
      }
    }
    showToast("Không tìm thấy thửa " + soTo + "/" + soThua);
  }

  function searchCoord() {
    var x = parseFloat($("#inp-x").value.trim().replace(",", "."));
    var y = parseFloat($("#inp-y").value.trim().replace(",", "."));
    if (isNaN(x) || isNaN(y)) {
      showToast("Tọa độ không hợp lệ");
      return;
    }
    if (x < 100 || x > 110 || y < 8 || y > 24) {
      showToast("Tọa độ ngoài vùng Việt Nam");
      return;
    }
    var coord3857 = ol.proj.fromLonLat([x, y]);
    if (gpsMarker) map.removeOverlay(gpsMarker);
    var el = document.createElement("div");
    el.style.cssText =
      "width:14px;height:14px;border-radius:50%;background:#1a9fd1;border:2px solid #fff;box-shadow:0 0 6px rgba(0,0,0,0.4);";
    gpsMarker = new ol.Overlay({
      element: el,
      positioning: "center-center",
      position: coord3857
    });
    map.addOverlay(gpsMarker);
    map.getView().animate({
      center: coord3857,
      zoom: Math.max(map.getView().getZoom(), 17),
      duration: CFG.BAY_DEN_THUA_MUOT ? 400 : 0
    });
    var pixel = map.getPixelFromCoordinate(coord3857);
    var feature = map.forEachFeatureAtPixel(
      pixel,
      function (f) {
        return f;
      },
      {
        layerFilter: function (l) {
          return l === parcelLayer;
        }
      }
    );
    if (feature) selectFeature(feature);
    else showToast("Đã ghim tọa độ");
  }

  function onOwnerInput() {
    var q = $("#inp-owner").value.trim().toLowerCase();
    var list = $("#suggest-owner");
    list.innerHTML = "";
    var st = $("#suggest-tothua");
    if (st) st.innerHTML = "";
    if (q.length < 2 || !ownerIndex) return;
    var count = 0;
    for (var i = 0; i < ownerIndex.length && count < 20; i++) {
      var item = ownerIndex[i];
      if (item.name.toLowerCase().indexOf(q) !== -1) {
        var div = document.createElement("div");
        div.className = "suggest-item";
        div.textContent = item.name;
        (function (feat) {
          div.addEventListener("click", function () {
            selectFeature(feat);
            list.innerHTML = "";
            $("#inp-owner").value = feat.get(F.chuSuDung) || "";
          });
        })(item.feature);
        list.appendChild(div);
        count++;
      }
    }
  }

  // ---------- measure ----------
  function formatLength(line) {
    var length = ol.sphere.getLength(line);
    return length > 1000
      ? (length / 1000).toFixed(2) + " km"
      : length.toFixed(1) + " m";
  }

  function formatArea(polygon) {
    var area = ol.sphere.getArea(polygon);
    var peri = 0;
    var coords = polygon.getLinearRing(0).getCoordinates();
    for (var i = 0; i < coords.length - 1; i++) {
      peri += ol.sphere.getDistance(
        ol.proj.toLonLat(coords[i]),
        ol.proj.toLonLat(coords[i + 1])
      );
    }
    var areaStr =
      area > 10000
        ? (area / 10000).toFixed(2) + " ha"
        : area.toFixed(1) + " m²";
    var periStr =
      peri > 1000 ? (peri / 1000).toFixed(2) + " km" : peri.toFixed(1) + " m";
    return areaStr + " · chu vi " + periStr;
  }

  function startMeasure(type) {
    stopMeasure();
    measureType = type;
    $$(".tool-btn[data-tool]").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-tool") === type);
    });
    measureDraw = new ol.interaction.Draw({
      source: measureSource,
      type: type,
      style: new ol.style.Style({
        fill: new ol.style.Fill({ color: "rgba(59,184,224,0.15)" }),
        stroke: new ol.style.Stroke({
          color: "#1a9fd1",
          width: 2,
          lineDash: [8, 6]
        }),
        image: new ol.style.Circle({
          radius: 5,
          fill: new ol.style.Fill({ color: "#1a9fd1" })
        })
      })
    });
    map.addInteraction(measureDraw);
    var resultEl = $("#measure-result");
    resultEl.classList.add("visible");
    resultEl.textContent =
      type === "LineString"
        ? "Bấm các điểm để đo khoảng cách..."
        : "Bấm các điểm để đo diện tích...";

    measureDraw.on("drawstart", function (evt) {
      measureSource.clear();
      var sketch = evt.feature;
      measureListener = sketch.getGeometry().on("change", function (e) {
        var geom = e.target;
        if (geom.getType() === "LineString") {
          resultEl.textContent = "Chiều dài: " + formatLength(geom);
        } else if (geom.getType() === "Polygon") {
          resultEl.textContent = "Diện tích: " + formatArea(geom);
        }
      });
    });
    measureDraw.on("drawend", function (evt) {
      var geom = evt.feature.getGeometry();
      if (geom.getType() === "LineString") {
        resultEl.textContent = "Chiều dài: " + formatLength(geom);
      } else {
        resultEl.textContent = "Diện tích: " + formatArea(geom);
      }
      if (measureListener) {
        ol.Observable.unByKey(measureListener);
        measureListener = null;
      }
    });
  }

  function stopMeasure() {
    if (measureDraw) {
      map.removeInteraction(measureDraw);
      measureDraw = null;
    }
    if (measureListener) {
      ol.Observable.unByKey(measureListener);
      measureListener = null;
    }
    measureType = null;
    $$(".tool-btn[data-tool]").forEach(function (b) {
      b.classList.remove("active");
    });
  }

  function clearMeasure() {
    stopMeasure();
    measureSource.clear();
    $("#measure-result").classList.remove("visible");
  }

  function locateMe() {
    if (!navigator.geolocation) {
      showToast("Trình duyệt không hỗ trợ định vị");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      function (pos) {
        var coord = ol.proj.fromLonLat([
          pos.coords.longitude,
          pos.coords.latitude
        ]);
        if (gpsMarker) map.removeOverlay(gpsMarker);
        var el = document.createElement("div");
        el.style.cssText =
          "width:16px;height:16px;border-radius:50%;background:#1a9fd1;border:3px solid #fff;box-shadow:0 0 0 6px rgba(59,184,224,0.3);";
        gpsMarker = new ol.Overlay({
          element: el,
          positioning: "center-center",
          position: coord
        });
        map.addOverlay(gpsMarker);
        map.getView().animate({
          center: coord,
          zoom: 17,
          duration: CFG.BAY_DEN_THUA_MUOT ? 400 : 0
        });
      },
      function () {
        showToast("Không lấy được vị trí GPS");
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }

  function resetExtent() {
    map.getView().animate({
      center: ol.proj.fromLonLat([CFG.TAM_BAN_DO[1], CFG.TAM_BAN_DO[0]]),
      zoom: CFG.ZOOM_MAC_DINH,
      duration: CFG.BAY_DEN_THUA_MUOT ? 300 : 0
    });
  }

  // ---------- tabs / UI ----------
  function setTab(tab) {
    currentTab = tab;
    $$(".tabs button").forEach(function (b) {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    var boxTo = $("#search-tothua");
    var boxOwn = $("#search-owner");
    if (boxTo) {
      boxTo.style.display = tab === "tothua" ? "" : "none";
      boxTo.classList.toggle("active", tab === "tothua");
    }
    if (boxOwn) {
      boxOwn.style.display = tab === "owner" ? "" : "none";
      boxOwn.classList.toggle("active", tab === "owner");
    }
    $("#search-coord").classList.toggle("visible", tab === "coord");
    var st = $("#suggest-tothua");
    var so = $("#suggest-owner");
    if (st) st.innerHTML = "";
    if (so) so.innerHTML = "";
  }

  function bindUI() {
    $("#disclaimer").textContent = CFG.DISCLAIMER;

    $$(".tabs button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        setTab(btn.dataset.tab);
      });
    });

    $("#btn-search-go").addEventListener("click", function () {
      if (currentTab === "tothua") searchToThua();
      else if (currentTab === "coord") searchCoord();
    });

    $("#inp-tothua").addEventListener("keydown", function (e) {
      if (e.key === "Enter") searchToThua();
    });
    $("#inp-x").addEventListener("keydown", function (e) {
      if (e.key === "Enter") searchCoord();
    });
    $("#inp-y").addEventListener("keydown", function (e) {
      if (e.key === "Enter") searchCoord();
    });
    $("#inp-owner").addEventListener("input", onOwnerInput);
    $("#inp-tothua").addEventListener("input", onToThuaInput);

    $("#btn-zoom-in").addEventListener("click", function () {
      map.getView().animate({
        zoom: map.getView().getZoom() + 1,
        duration: 200
      });
    });
    $("#btn-zoom-out").addEventListener("click", function () {
      map.getView().animate({
        zoom: map.getView().getZoom() - 1,
        duration: 200
      });
    });
    $("#btn-locate").addEventListener("click", locateMe);
    $("#btn-reset").addEventListener("click", resetExtent);
    $("#btn-measure-line").addEventListener("click", function () {
      if (measureType === "LineString") clearMeasure();
      else startMeasure("LineString");
    });
    $("#btn-measure-area").addEventListener("click", function () {
      if (measureType === "Polygon") clearMeasure();
      else startMeasure("Polygon");
    });
    $("#btn-measure-clear").addEventListener("click", clearMeasure);

    $("#btn-layers").addEventListener("click", function (e) {
      e.stopPropagation();
      $("#layer-popover").classList.toggle("open");
      this.classList.toggle("active");
    });
    var layerPop = $("#layer-popover");
    if (layerPop) {
      layerPop.addEventListener("click", function (e) {
        e.stopPropagation();
      });
    }
    document.addEventListener("click", function (e) {
      var pop = $("#layer-popover");
      var btn = $("#btn-layers");
      var toolbar = document.querySelector(".toolbar");
      var searchBar = document.querySelector(".search-bar");
      var t = e.target;
      if (pop && pop.classList.contains("open")) {
        if (btn && (btn === t || btn.contains(t))) return;
        if (pop.contains(t)) return;
        pop.classList.remove("open");
        if (btn) btn.classList.remove("active");
      }
      // Đóng gợi ý khi bấm ra ngoài ô tìm
      if (searchBar && !searchBar.contains(t)) {
        var st = $("#suggest-tothua");
        var so = $("#suggest-owner");
        if (st) st.innerHTML = "";
        if (so) so.innerHTML = "";
      }
    });

    $("#chk-parcel").addEventListener("change", function () {
      parcelLayer.setVisible(this.checked);
    });
    $("#opacity-parcel").addEventListener("input", function () {
      parcelLayer.setOpacity(this.value / 100);
    });
    var chkPlan = $("#chk-planning");
    if (chkPlan) {
      chkPlan.addEventListener("change", function () {
        planningLayer.setVisible(this.checked);
      });
    }
    var opPlan = $("#opacity-planning");
    if (opPlan) {
      opPlan.addEventListener("input", function () {
        planningLayer.setOpacity(this.value / 100);
      });
    }

    var btnAll = $("#btn-sheet-all");
    var btnNone = $("#btn-sheet-none");
    var sheetFilter = $("#sheet-filter");
    if (btnAll) {
      btnAll.addEventListener("click", function (e) {
        e.stopPropagation();
        hiddenSheets = {};
        renderSheetList(sheetFilter ? sheetFilter.value : "");
        refreshLayers();
      });
    }
    if (btnNone) {
      btnNone.addEventListener("click", function (e) {
        e.stopPropagation();
        for (var i = 0; i < sheetStats.length; i++) {
          hiddenSheets[sheetStats[i].id] = true;
        }
        renderSheetList(sheetFilter ? sheetFilter.value : "");
        refreshLayers();
      });
    }
    if (sheetFilter) {
      sheetFilter.addEventListener("input", function () {
        renderSheetList(this.value);
      });
      sheetFilter.addEventListener("click", function (e) {
        e.stopPropagation();
      });
    }

    $$(".basemap-row button").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.dataset.base;
        Object.keys(baseLayers).forEach(function (k) {
          baseLayers[k].setVisible(k === key);
        });
        $$(".basemap-row button").forEach(function (b) {
          b.classList.toggle("active", b === btn);
        });
      });
    });

    $("#btn-copy").addEventListener("click", function () {
      if (!lastInfoText) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(lastInfoText).then(
          function () {
            showToast("Đã sao chép thông tin");
          },
          function () {
            showToast("Không sao chép được");
          }
        );
      } else {
        showToast("Trình duyệt không hỗ trợ sao chép");
      }
    });

    $("#btn-direction").addEventListener("click", function () {
      if (!lastCenterLonLat) return;
      var url =
        "https://www.google.com/maps/dir/?api=1&destination=" +
        lastCenterLonLat[1] +
        "," +
        lastCenterLonLat[0];
      window.open(url, "_blank", "noopener,noreferrer");
    });

    setTab("tothua");
  }

  function boot() {
    if (typeof ol === "undefined") {
      alert("Không tải được OpenLayers");
      return;
    }
    if (typeof json_Aggregated_1 === "undefined") {
      alert("Không tải được dữ liệu thửa đất");
      return;
    }
    if (typeof styleAggregated === "undefined") {
      alert("Không tải được style");
      return;
    }
    if (typeof json_VungNhutTao_2 === "undefined") {
      console.warn("Không tải được lớp quy hoạch VungNhutTao_2 – chỉ hiển thị thửa đất");
    }
    bindUI();
    initMap();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
