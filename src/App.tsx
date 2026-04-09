import { useState, useEffect, useRef, useCallback } from "react";

// ============================================================
// 计价方案定义
// ============================================================
const DEFAULT_SCHEMES = [
  {
    id: 1, name: "深圳计价方式",
    startFare: 12, startKm: 3,
    meterRate: 2.6, meterInterval: 100,
    timeFare: 0.6, timeFreeMin: 9, timeInterval: 60,
    longFare: 0.4, longStartKm: 12,
  },
  {
    id: 2, name: "广州计价方式",
    startFare: 12, startKm: 3,
    meterRate: 2.6, meterInterval: 100,
    timeFare: 0.6, timeFreeMin: 9, timeInterval: 60,
    longFare: 0.4, longStartKm: 12,
  },
  {
    id: 3, name: "上海计价方式",
    startFare: 14, startKm: 3,
    meterRate: 2.5, meterInterval: 100,
    timeFare: 0.7, timeFreeMin: 5, timeInterval: 60,
    longFare: 0.5, longStartKm: 15,
  },
  {
    id: 4, name: "成都计价方式",
    startFare: 10, startKm: 3,
    meterRate: 1.9, meterInterval: 100,
    timeFare: 0.5, timeFreeMin: 10, timeInterval: 60,
    longFare: 0.3, longStartKm: 10,
  },
];

// ============================================================
// 工具函数
// ============================================================
function fmtTime(s: number) {
  const h = String(Math.floor(s / 3600)).padStart(2, "0");
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const sc = String(s % 60).padStart(2, "0");
  return `${h}:${m}:${sc}`;
}

/** Haversine 公式计算两点间球面距离（米） */
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) *
      Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================================
// 计费核心逻辑（已修复）
// ============================================================
function calcFare(scheme: typeof DEFAULT_SCHEMES[0], dist: number, secs: number, extra: number) {
  const { startFare, startKm, meterRate, meterInterval, timeFare, timeFreeMin, timeInterval, longFare, longStartKm } = scheme;
  const distKm = dist / 1000;

  // 里程费
  const meterDist = Math.max(0, distKm - startKm);
  const meterTicks = Math.floor((meterDist * 1000) / meterInterval);
  const meterCost = meterTicks * (meterRate * meterInterval / 1000);

  // 时长费（修复：先取可计费秒数，再 floor，避免负数问题）
  const billableSecs = Math.max(0, secs - timeFreeMin * 60);
  const timeTicks = Math.floor(billableSecs / timeInterval);
  const timeCost = timeTicks * (timeFare * timeInterval / 60);

  // 长途费
  const longDist = Math.max(0, distKm - longStartKm);
  const longCost =
    longDist > 0
      ? Math.floor((longDist * 1000) / meterInterval) * (longFare * meterInterval / 1000)
      : 0;

  const total = startFare + meterCost + timeCost + longCost + extra;

  return {
    startFare,
    meterCost: +meterCost.toFixed(1),
    timeCost: +timeCost.toFixed(1),
    longCost: +longCost.toFixed(1),
    total: +total.toFixed(1),
  };
}

// ============================================================
// 视图类型
// ============================================================
const VIEWS = { METER: "meter", SCHEMES: "schemes", EDIT: "edit", RECORDS: "records" } as const;

// ============================================================
// 主组件
// ============================================================
export default function App() {
  const [view, setView] = useState<typeof VIEWS[keyof typeof VIEWS]>(VIEWS.METER);
  const [schemes, setSchemes] = useState(DEFAULT_SCHEMES);
  const [activeSchemeId, setActiveSchemeId] = useState(1);
  const [editScheme, setEditScheme] = useState<typeof DEFAULT_SCHEMES[0] | null>(null);
  const [status, setStatus] = useState<"idle" | "running" | "paused">("idle");
  const [dist, setDist] = useState(0);
  const [secs, setSecs] = useState(0);
  const [extra, setExtra] = useState(0);
  const [records, setRecords] = useState<Array<{
    id: number; label: string; time: string; fare: number; dist: number; secs: number;
  }>>([]);

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchRef = useRef<number | null>(null);
  const posRef = useRef<{ lat: number; lng: number } | null>(null);
  const distRef = useRef(0);
  const secsRef = useRef(0);
  const extraRef = useRef(0);

  distRef.current = dist;
  secsRef.current = secs;
  extraRef.current = extra;

  const scheme = schemes.find(s => s.id === activeSchemeId) || schemes[0];
  const fare = calcFare(scheme, dist, secs, extra);

  // ============================================================
  // GPS 控制
  // ============================================================
  const startGPS = useCallback(() => {
    if (!navigator.geolocation) return;
    watchRef.current = navigator.geolocation.watchPosition(
      pos => {
        const { latitude: lat, longitude: lng } = pos.coords;
        if (posRef.current) {
          const d = haversine(posRef.current.lat, posRef.current.lng, lat, lng);
          setDist(prev => prev + d);
        }
        posRef.current = { lat, lng };
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 5000 }
    );
  }, []);

  const stopGPS = useCallback(() => {
    if (watchRef.current != null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
    posRef.current = null;
  }, []);

  // ============================================================
  // 业务逻辑
  // ============================================================
  function handleStart() {
    setStatus("running");
    startGPS();
    timerRef.current = setInterval(() => setSecs(s => s + 1), 1000);
  }

  function handlePause() {
    if (status === "running") {
      setStatus("paused");
      stopGPS();
      if (timerRef.current) clearInterval(timerRef.current);
    } else {
      setStatus("running");
      startGPS();
      timerRef.current = setInterval(() => setSecs(s => s + 1), 1000);
    }
  }

  function handleEnd() {
    if (timerRef.current) clearInterval(timerRef.current);
    stopGPS();
    const f = calcFare(scheme, distRef.current, secsRef.current, extraRef.current);
    const rec = {
      id: Date.now(),
      label: `行程记录${records.length + 1}`,
      time: new Date().toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }),
      fare: f.total,
      dist: +(distRef.current / 1000).toFixed(2),
      secs: secsRef.current,
    };
    setRecords(prev => [rec, ...prev]);
    setDist(0); setSecs(0); setExtra(0); setStatus("idle");
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      stopGPS();
    };
  }, [stopGPS]);

  // ============================================================
  // 计价器视图
  // ============================================================
  const MeterView = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* 计价面板 */}
      <div style={{ background: "#111", borderRadius: 16, padding: "20px 16px 16px", display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ color: "#888", fontSize: 13, letterSpacing: 4 }}>F A R E</span>
          <button
            onClick={() => setView(VIEWS.SCHEMES)}
            style={{ background: "none", border: "none", color: "#e8b84b", fontSize: 12, cursor: "pointer" }}
          >
            {scheme.name} ▼
          </button>
        </div>

        <div style={{ textAlign: "center", padding: "8px 0" }}>
          <span style={{ fontFamily: "monospace", fontSize: 64, fontWeight: "bold", color: "#e03c3c", letterSpacing: 4, textShadow: "0 0 20px rgba(224,60,60,0.3)" }}>
            {fare.total.toFixed(1)}
          </span>
          <div style={{ color: "#666", fontSize: 13, marginTop: 4 }}>CNY ¥</div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
          {[
            ["起步费", fare.startFare],
            ["里程费", fare.meterCost],
            ["时长费", fare.timeCost],
            ["长途费", fare.longCost],
            ["附加费", extra],
          ].map(([k, v]) => (
            <div key={k} style={{ textAlign: "center" }}>
              <div style={{ color: "#555", fontSize: 11 }}>{k}</div>
              <div style={{ color: "#aaa", fontSize: 13 }}>{(+v).toFixed(1)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 状态栏 */}
      <div style={{ background: "#111", borderRadius: 12, padding: "10px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#555", fontSize: 11 }}>里程</div>
          <div style={{ color: "#aaa", fontSize: 15, fontFamily: "monospace" }}>{(dist / 1000).toFixed(2)} km</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#555", fontSize: 11 }}>
            {status === "idle" ? "待机" : status === "running" ? <span>计费中 <span style={{ color: "#4ade80", fontSize: 18 }}>●</span></span> : "已暂停"}
          </div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ color: "#555", fontSize: 11 }}>时长</div>
          <div style={{ color: "#aaa", fontSize: 15, fontFamily: "monospace" }}>{fmtTime(secs)}</div>
        </div>
      </div>

      {/* 附加费 */}
      {status !== "idle" && (
        <div style={{ display: "flex", gap: 8 }}>
          {[["附加 ¥10", 10], ["附加 ¥1", 1]].map(([label, amt]) => (
            <button
              key={label}
              onClick={() => setExtra(e => +(e + (amt as number)).toFixed(1))}
              style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "0.5px solid #333", background: "#1a1a1a", color: "#ccc", fontSize: 14, cursor: "pointer" }}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => setExtra(0)}
            style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "0.5px solid #333", background: "#1a1a1a", color: "#888", fontSize: 14, cursor: "pointer" }}
          >
            清空附加
          </button>
        </div>
      )}

      {/* 主操作按钮 */}
      <div style={{ display: "flex", gap: 8 }}>
        {status === "idle" ? (
          <button
            onClick={handleStart}
            style={{ flex: 1, padding: "14px 0", borderRadius: 10, border: "none", background: "#e03c3c", color: "#fff", fontSize: 16, fontWeight: 500, cursor: "pointer" }}
          >
            开始计费
          </button>
        ) : (
          <>
            <button
              onClick={handleEnd}
              style={{ flex: 1, padding: "14px 0", borderRadius: 10, border: "none", background: "#e03c3c", color: "#fff", fontSize: 16, fontWeight: 500, cursor: "pointer" }}
            >
              结束
            </button>
            <button
              onClick={handlePause}
              style={{ flex: 1, padding: "14px 0", borderRadius: 10, border: "0.5px solid #444", background: "#1a1a1a", color: "#ccc", fontSize: 16, cursor: "pointer" }}
            >
              {status === "running" ? "暂停" : "继续"}
            </button>
          </>
        )}
      </div>

      {/* 底部导航 */}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          onClick={() => setView(VIEWS.RECORDS)}
          style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "0.5px solid #333", background: "#111", color: "#888", fontSize: 13, cursor: "pointer" }}
        >
          行程记录
        </button>
        <button
          onClick={() => setView(VIEWS.SCHEMES)}
          style={{ flex: 1, padding: "10px 0", borderRadius: 8, border: "0.5px solid #333", background: "#111", color: "#888", fontSize: 13, cursor: "pointer" }}
        >
          计价方式
        </button>
      </div>
    </div>
  );

  // ============================================================
  // 计价方式列表
  // ============================================================
  const SchemesView = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button onClick={() => setView(VIEWS.METER)} style={{ background: "none", border: "none", color: "#e8b84b", fontSize: 14, cursor: "pointer" }}>← 返回</button>
        <span style={{ color: "#ccc", fontSize: 15 }}>计价方式</span>
        <button
          onClick={() => {
            setEditScheme({
              id: Date.now(),
              name: "新计价方式",
              startFare: 12, startKm: 3,
              meterRate: 2.6, meterInterval: 100,
              timeFare: 0.6, timeFreeMin: 9, timeInterval: 60,
              longFare: 0.4, longStartKm: 12,
            });
            setView(VIEWS.EDIT);
          }}
          style={{ background: "none", border: "none", color: "#e8b84b", fontSize: 20, cursor: "pointer" }}
        >
          +
        </button>
      </div>

      {schemes.map(s => (
        <div
          key={s.id}
          onClick={() => { setActiveSchemeId(s.id); setView(VIEWS.METER); }}
          style={{
            background: s.id === activeSchemeId ? "#1e1a0a" : "#111",
            border: `1.5px solid ${s.id === activeSchemeId ? "#e8b84b" : "#222"}`,
            borderRadius: 12, padding: "12px 16px", cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
            <span style={{ color: s.id === activeSchemeId ? "#e8b84b" : "#ccc", fontSize: 15, fontWeight: 500 }}>{s.name}</span>
            <button
              onClick={e => { e.stopPropagation(); setEditScheme({ ...s }); setView(VIEWS.EDIT); }}
              style={{ background: "none", border: "none", color: "#555", fontSize: 12, cursor: "pointer" }}
            >
              编辑
            </button>
          </div>
          <div style={{ color: "#666", fontSize: 12, lineHeight: 1.8 }}>
            <div>起步价：{s.startKm}公里内{s.startFare}元</div>
            <div>里程费：{s.meterRate}元/公里，每{s.meterInterval}米计费一次</div>
            <div>时长费：{s.timeFare}元/分钟，{s.timeFreeMin}分钟内免费</div>
            <div>长途费：{s.longFare}元/公里，第{s.longStartKm}公里起</div>
          </div>
        </div>
      ))}
    </div>
  );

  // ============================================================
  // 编辑计价方式（修复：恢复按钮重置到该方案的原始值）
  // ============================================================
  const EditView = () => {
    // 记录进入编辑时该方案的默认值（用于"恢复默认"）
    const originalDefault = DEFAULT_SCHEMES.find(s => s.id === editScheme!.id) || DEFAULT_SCHEMES[0];
    const [form, setForm] = useState(editScheme);

    const upd = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));

    const save = () => {
      if (schemes.find(s => s.id === form!.id)) {
        setSchemes(ss => ss.map(s => s.id === form!.id ? form! : s));
      } else {
        setSchemes(ss => [...ss, form!]);
      }
      setActiveSchemeId(form!.id);
      setView(VIEWS.SCHEMES);
    };

    const fields: [string, string, string][] = [
      ["计价名称", "name", "text"],
      ["起步价(元)", "startFare", "number"],
      ["起步包含里程(公里)", "startKm", "number"],
      ["里程费(元/公里)", "meterRate", "number"],
      ["计费刷新频率(米/次)", "meterInterval", "number"],
      ["时长费(元/分钟)", "timeFare", "number"],
      ["开始计费时间(分钟)", "timeFreeMin", "number"],
      ["计费刷新频率(秒/次)", "timeInterval", "number"],
      ["长途费(元/公里)", "longFare", "number"],
      ["长途开始里程(公里)", "longStartKm", "number"],
    ];

    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={() => setView(VIEWS.SCHEMES)} style={{ background: "none", border: "none", color: "#e8b84b", fontSize: 14, cursor: "pointer" }}>← 返回</button>
          <span style={{ color: "#ccc", fontSize: 15 }}>编辑计价方式</span>
          {/* 修复：恢复当前编辑项的原始默认值，而非固定深圳方案 */}
          <button
            onClick={() => setForm({ ...originalDefault })}
            style={{ background: "none", border: "none", color: "#888", fontSize: 12, cursor: "pointer" }}
          >
            恢复默认
          </button>
        </div>

        {fields.map(([label, key, type]) => (
          <div key={key} style={{ background: "#111", borderRadius: 10, padding: "12px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span style={{ color: "#888", fontSize: 13 }}>{label}</span>
            <input
              type={type}
              value={form![key as keyof typeof form]}
              onChange={e => upd(key, type === "number" ? +e.target.value : e.target.value)}
              style={{ background: "#222", border: "0.5px solid #333", borderRadius: 6, padding: "4px 10px", color: "#ccc", fontSize: 13, width: 90, textAlign: "right" }}
            />
          </div>
        ))}

        <button
          onClick={save}
          style={{ padding: "14px 0", borderRadius: 10, border: "none", background: "#e8b84b", color: "#111", fontSize: 15, fontWeight: 500, cursor: "pointer", marginTop: 8 }}
        >
          保存并启用
        </button>
      </div>
    );
  };

  // ============================================================
  // 行程记录
  // ============================================================
  const RecordsView = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button onClick={() => setView(VIEWS.METER)} style={{ background: "none", border: "none", color: "#e8b84b", fontSize: 14, cursor: "pointer" }}>← 返回</button>
        <span style={{ color: "#ccc", fontSize: 15 }}>行程记录</span>
        <span style={{ fontSize: 13, color: "#555" }}>{records.length}条</span>
      </div>

      {records.length === 0 ? (
        <div style={{ textAlign: "center", color: "#444", padding: "40px 0", fontSize: 14 }}>暂无记录</div>
      ) : records.map(r => (
        <div key={r.id} style={{ background: "#111", border: "0.5px solid #222", borderRadius: 12, padding: "12px 16px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ color: "#ccc", fontSize: 14, marginBottom: 4 }}>{r.label}</div>
            <div style={{ color: "#555", fontSize: 12 }}>{r.time} · {r.dist}km · {fmtTime(r.secs)}</div>
          </div>
          <div style={{ color: "#e8b84b", fontSize: 18, fontWeight: 500 }}>¥{r.fare.toFixed(1)}</div>
        </div>
      ))}
    </div>
  );

  // ============================================================
  // 渲染
  // ============================================================
  return (
    <div style={{ background: "#0d0d0d", minHeight: "100vh", padding: "20px 16px 40px", maxWidth: 420, margin: "0 auto" }}>
      {view === VIEWS.METER && <MeterView />}
      {view === VIEWS.SCHEMES && <SchemesView />}
      {view === VIEWS.EDIT && editScheme && <EditView />}
      {view === VIEWS.RECORDS && <RecordsView />}
    </div>
  );
}
