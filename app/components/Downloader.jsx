"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/* آدرس سرور FastAPI — در استقرار نهایی با متغیر محیطي NEXT_PUBLIC_API_URL تنظیم می‌شود */
const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/* ---------------- کمکی‌ها ---------------- */
function fmtSize(b) {
  if (!b || b <= 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let n = b;
  while (n >= 1024 && i < u.length - 1) {
    n /= 1024;
    i++;
  }
  return (i === 0 ? n : n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)) + " " + u[i];
}
function fmtSpeed(s) {
  return s && s > 0 ? fmtSize(s) + "/s" : "—";
}
function fmtEta(s) {
  if (s === null || s === undefined || s === "") return "—";
  s = Math.round(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(sec)}` : `${p(m)}:${p(sec)}`;
}
function fmtDur(s) {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(sec).padStart(2, "0");
}
function fmtViews(v) {
  if (!v) return "";
  if (v >= 1e6) return (v / 1e6).toFixed(1) + "M بازدید";
  if (v >= 1e3) return (v / 1e3).toFixed(1) + "K بازدید";
  return v + " بازدید";
}
function looksLikeUrl(t) {
  return /^(https?:\/\/|www\.)\S+$/i.test(t) || /^[a-z0-9-]+(\.[a-z0-9-]+)+([\/?#]\S*)?$/i.test(t);
}
function logClass(t) {
  if (t.startsWith("ERROR")) return "e";
  if (t.startsWith("WARNING")) return "w";
  if (t.startsWith("[APP]")) return "a";
  if (t.includes("Finished:")) return "ok";
  return "";
}

async function api(path, body) {
  const opt =
    body !== undefined
      ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
      : {};
  try {
    const r = await fetch(API + path, opt);
    return await r.json();
  } catch {
    return { ok: false, error: "ارتباط با سرور برقرار نشد" };
  }
}

/* ---------------- کامپوننت اصلی ---------------- */
export default function Downloader() {
  const [health, setHealth] = useState({ online: false, ytdlp: "", ffmpeg: false });
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [video, setVideo] = useState(null);
  const [qualities, setQualities] = useState([]);
  const [pickedKey, setPickedKey] = useState("");
  const [errCard, setErrCard] = useState(null); // {msg, hint}
  const [proxy, setProxy] = useState("");
  const [subs, setSubs] = useState({ enabled: true, langs: "en,fa", auto: true });
  const [job, setJob] = useState(null); // {id, label}
  const [st, setSt] = useState(null);   // آخرین وضعیت سرور
  const [log, setLog] = useState([]);
  const [toasts, setToasts] = useState([]);

  const seqRef = useRef(0);
  const prevPhaseRef = useRef(null);
  const toastSeq = useRef(0);
  const logBoxRef = useRef(null);

  const toast = useCallback((msg, type) => {
    const id = ++toastSeq.current;
    setToasts((t) => [...t, { id, msg, type: type || "info" }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200);
  }, []);

  /* ---- سلامت سرور ---- */
  const checkHealth = useCallback(async () => {
    const r = await api("/api/health").catch(() => null);
    if (r && r.ok) setHealth({ online: true, ytdlp: r.ytdlp || "", ffmpeg: !!r.ffmpeg });
    else setHealth((h) => ({ ...h, online: false }));
  }, []);
  useEffect(() => {
    checkHealth();
    const t = setInterval(checkHealth, 30000);
    return () => clearInterval(t);
  }, [checkHealth]);

  /* ---- بررسی کیفیت‌ها ---- */
  const doFetch = useCallback(
    async (overrideUrl) => {
      const u = (overrideUrl !== undefined ? overrideUrl : url).trim();
      if (!u) {
        toast("اول لینک ویدیو را وارد کنید", "bad");
        return;
      }
      setFetching(true);
      setErrCard(null);
      const r = await api("/api/fetch", { url: u, proxy: proxy.trim() });
      setFetching(false);
      if (!r.ok) {
        setErrCard({ msg: r.error || "خطا", hint: r.hint || "" });
        toast(r.error || "خطا", "bad");
        return;
      }
      setVideo(r.video);
      setQualities(r.qualities || []);
      setPickedKey("");
      toast((r.qualities || []).length + " کیفیت پیدا شد", "ok");
    },
    [url, proxy, toast]
  );

  const pasteUrl = useCallback(async () => {
    try {
      const t = (await navigator.clipboard.readText()).trim();
      if (!t) {
        toast("کلیپ‌بورد خالی است", "bad");
        return;
      }
      setUrl(looksLikeUrl(t) ? t : t);
      toast("لینک الصاق شد ✅", "ok");
    } catch {
      toast("دسترسی به کلیپ‌بورد ممکن نشد — کلیدهای Ctrl+V را بزنید", "bad");
    }
  }, [toast]);

  /* ---- شروع دانلود ---- */
  const startJob = useCallback(
    async (path, body, label) => {
      const r = await api(path, body);
      if (!r.ok) {
        toast(r.error || "خطا", "bad");
        return;
      }
      seqRef.current = 0;
      prevPhaseRef.current = null;
      setLog([]);
      setSt(null);
      setJob({ id: r.job_id, label });
      toast(label + " در صف قرار گرفت 🚀", "ok");
    },
    [toast]
  );

  const pickQuality = useCallback(
    async (q) => {
      if (job && st && (st.phase === "running" || st.phase === "queued")) {
        toast("یک عملیات در جریان است؛ اول صبر کنید", "bad");
        return;
      }
      if (!video) return;
      setPickedKey(q.key);
      const label = q.kind === "audio" ? "صدا" : q.label;
      await startJob(
        "/api/download",
        {
          url: video.url,
          selector: q.selector,
          label,
          proxy: proxy.trim(),
          subs_enabled: !!subs.enabled,
          subs_langs: subs.langs.trim() || "en,fa",
          subs_auto: !!subs.auto,
        },
        "دانلود «" + label + "»"
      );
    },
    [job, st, video, proxy, subs, startJob, toast]
  );

  const doSubsOnly = useCallback(async () => {
    const u = (video ? video.url : url).trim();
    if (!u) {
      toast("اول لینک ویدیو را وارد کنید", "bad");
      return;
    }
    await startJob(
      "/api/subs",
      { url: u, proxy: proxy.trim(), langs: subs.langs.trim() || "en,fa", auto: !!subs.auto },
      "زیرنویس"
    );
  }, [video, url, proxy, subs, startJob, toast]);

  const doCancel = useCallback(async () => {
    if (!job) return;
    await api("/api/cancel", { job_id: job.id });
    toast("در حال لغو…", "info");
  }, [job, toast]);

  /* ---- poll وضعیت کار ---- */
  useEffect(() => {
    if (!job) return undefined;
    let stopped = false;
    let timer = null;

    const tick = async () => {
      if (stopped) return;
      let active = true;
      try {
        const r = await fetch(`${API}/api/jobs/${job.id}?logFrom=${seqRef.current}`).then((x) =>
          x.json()
        );
        if (stopped) return;
        if (r.ok) {
          const s = r.state;
          if (s.log_reset) setLog(s.log || []);
          else if (s.log && s.log.length) setLog((prev) => [...prev, ...s.log].slice(-900));
          seqRef.current = s.log_seq || 0;

          const prev = prevPhaseRef.current;
          prevPhaseRef.current = s.phase;
          active = s.phase === "running" || s.phase === "queued";
          if (prev && prev !== s.phase) {
            if (s.phase === "done") toast("عملیات کامل شد ✅", "ok");
            else if (s.phase === "error") toast(s.error || "خطا در عملیات", "bad");
            else if (s.phase === "cancelled") toast("لغو شد؛ فایل ناقص برای ادامه حفظ می‌شود", "info");
          }
          setSt(s);
        } else {
          active = false;
        }
      } catch {
        /* تلاش بعدی */
      }
      if (!stopped) timer = setTimeout(tick, active ? 700 : 3000);
    };

    tick();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
    };
  }, [job, toast]);

  /* اسکرول خودکار لاگ */
  useEffect(() => {
    const el = logBoxRef.current;
    if (!el) return;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
    if (near) el.scrollTop = el.scrollHeight;
  }, [log]);

  /* ---- رندر کمکی ---- */
  const phase = st ? st.phase : null;
  const jobActive = phase === "running" || phase === "queued";
  const showDlCard = !!st && ["running", "done", "cancelled", "error"].includes(phase);
  const p = (st && st.progress) || {};
  const pct = phase === "done" ? 100 : p.percent || 0;
  const files = (st && st.files) || [];
  const subFiles = files.filter((f) => f.kind === "subtitle");

  let stateTxt = (st && st.status_text) || "در حال دانلود…";
  if (phase === "cancelled") stateTxt = "لغو شد — با انتخاب دوباره همان کیفیت، از همان‌جا ادامه می‌یابد";
  if (phase === "error") stateTxt = "خطا — دوباره تلاش کنید، دانلود از همان‌جا ادامه پیدا می‌کند";

  return (
    <>
      <div className="bg">
        <div className="blob b1"></div>
        <div className="blob b2"></div>
        <div className="blob b3"></div>
      </div>
      <div className="grid-lines"></div>

      <div className="wrap">
        {/* هدر */}
        <div className="topbar">
          <div className="brand">
            <div className="logo">⬇️</div>
            <div>
              <h1>
                Free<span>DL</span> <span style={{ fontSize: 13, fontWeight: 500 }}>Web</span>
              </h1>
              <p>دانلودر سریع و امن ویدیو — سروری با yt-dlp + ffmpeg</p>
            </div>
          </div>
          <div className="tools">
            <div className="pill">
              <span className={"dot" + (health.online ? "" : " off")}></span>
              <span>{health.online ? "سرور متصل" : "سرور قطع"}</span>
            </div>
            <div className="pill">{health.ytdlp ? "yt-dlp " + health.ytdlp : "yt-dlp"}</div>
            <div className="pill">{health.ffmpeg ? "ffmpeg ✔" : "ffmpeg ✖"}</div>
          </div>
        </div>

        {/* جستجو */}
        <div className="card search-card">
          <div className="search">
            <div className="inputwrap">
              <span className="ic">🔗</span>
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") doFetch();
                }}
                placeholder="لینک ویدیو را اینجا بچسبانید و Enter بزنید…"
                autoComplete="off"
                spellCheck="false"
              />
              <div className="acts">
                <button className="btn ghost sm" onClick={pasteUrl} title="الصاق لینک از کلیپ‌بورد">
                  📋 الصاق
                </button>
                <button className="btn ghost sm" onClick={() => setUrl("")} title="پاک کردن فیلد لینک">
                  ✖
                </button>
              </div>
            </div>
            <button className="btn" onClick={() => doFetch()} disabled={fetching}>
              {fetching ? "⏳ در حال بررسی…" : "🔍 بررسی کیفیت‌ها"}
            </button>
          </div>
          <div className="tips">
            <span className="flag">
              yt-dlp --fragment-retries infinite --retries infinite --keep-fragments
            </span>
          </div>
        </div>

        {/* خطای عمومی */}
        {errCard && (
          <div className="card err">
            <h2>⚠️ خطا</h2>
            <div className="msg">{errCard.msg}</div>
            {errCard.hint && <div className="hint">{errCard.hint}</div>}
            <div className="actions">
              <button className="btn sm" onClick={() => doFetch()}>
                🔄 تلاش دوباره
              </button>
              <button className="btn ghost sm" onClick={() => setErrCard(null)}>
                بستن
              </button>
            </div>
          </div>
        )}

        {/* لودینگ */}
        {fetching && (
          <div className="card loading">
            <div className="sp"></div>
            <span>در حال دریافت کیفیت‌های موجود…</span>
          </div>
        )}

        {/* اطلاعات ویدیو */}
        {video && !fetching && (
          <div className="card">
            <div className="video">
              <div className="thumb">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={video.thumbnail} alt="" />
                <span className="dur">{fmtDur(video.duration)}</span>
              </div>
              <div className="vinfo">
                <h3>{video.title}</h3>
                <div className="chips">
                  <span className="chip acc">📺 {video.channel || "—"}</span>
                  {video.views ? <span className="chip">{fmtViews(video.views)}</span> : null}
                  <span className="chip">{video.id}</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* کیفیت‌ها */}
        {video && !fetching && qualities.length > 0 && (
          <div className="card">
            <h2>
              🎬 کیفیت‌های موجود{" "}
              <span className="count">({qualities.length} گزینه — روی هر کدام کلیک کنید)</span>
            </h2>
            <div className="qgrid">
              {qualities.map((q) => (
                <button
                  key={q.key}
                  className={
                    "q" +
                    (q.key === "auto" ? " auto" : "") +
                    (q.kind === "audio" ? " audio" : "") +
                    (jobActive || pickedKey === q.key ? " locked" : "")
                  }
                  onClick={() => pickQuality(q)}
                >
                  {q.kind === "audio" ? (
                    <>
                      <div className="res">
                        🎵 <small>صدا</small>
                      </div>
                      <div className="meta">
                        <span>{q.ext || "audio"}</span>
                        {q.acodec ? <span>{q.acodec}</span> : null}
                        {q.tbr ? <span>{q.tbr}kbps</span> : null}
                      </div>
                      <div className="size">{q.size ? "≈ " + fmtSize(q.size) : "—"}</div>
                      <div className="dl">دانلود صدا ←</div>
                    </>
                  ) : (
                    <>
                      <div className="res">
                        {q.res}
                        <small>p</small>
                      </div>
                      {q.badge ? <span className="badge">{q.badge}</span> : null}
                      <div className="meta">
                        <span>{(q.ext || "").toUpperCase()}</span>
                        {q.vcodec ? <span>{q.vcodec}</span> : null}
                        {q.acodec ? <span>{q.acodec}</span> : null}
                        {q.fps && q.fps > 30 ? <span>{q.fps}fps</span> : null}
                        {q.tbr ? <span>{q.tbr}k</span> : null}
                      </div>
                      <div className="size">{q.size ? "≈ " + fmtSize(q.size) : "—"}</div>
                      <div className="dl">دانلود {q.label} ←</div>
                    </>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* پراکسی */}
        <div className="card">
          <h2>🌐 پراکسی سرور (اختیاری)</h2>
          <div className="row">
            <input
              type="text"
              className="monoinput"
              value={proxy}
              onChange={(e) => setProxy(e.target.value)}
              spellCheck="false"
              placeholder="خالی = بدون پراکسی — مثال: http://127.0.0.1:8080 یا socks5://user:pass@host:1080"
            />
          </div>
          <div className="subs-hint">
            روی درخواست‌های همین مرورگر اعمال می‌شود: بررسی، دانلود و زیرنویس.
          </div>
        </div>

        {/* زیرنویس */}
        <div className="card">
          <h2>🧩 زیرنویس (SRT) کنار فایل ویدیو</h2>
          <div className="subs-row">
            <label className="chk">
              <input
                type="checkbox"
                checked={subs.enabled}
                onChange={(e) => setSubs({ ...subs, enabled: e.target.checked })}
              />
              <span>هنگام دانلود، زیرنویس هم کنار ویدیو ذخیره شود</span>
            </label>
            <label className="chk">
              <input
                type="checkbox"
                checked={subs.auto}
                onChange={(e) => setSubs({ ...subs, auto: e.target.checked })}
              />
              <span>شامل زیرنویس خودکار (ASR)</span>
            </label>
          </div>
          <div className="langrow">
            <span className="lbl">زبان‌ها:</span>
            <input
              type="text"
              className="monoinput"
              value={subs.langs}
              onChange={(e) => setSubs({ ...subs, langs: e.target.value })}
              spellCheck="false"
              placeholder="en,fa"
            />
            <button className="btn ghost sm" onClick={doSubsOnly} disabled={jobActive}>
              🧩 فقط زیرنویس را بگیر (بدون ویدیو)
            </button>
          </div>
          <div className="subs-hint">
            مثال: <code>en,fa</code> &nbsp;•&nbsp; با جایگزینی: <code>en.*,fa.*</code> &nbsp;•&nbsp; همه:{" "}
            <code>all</code> — فایل با نام <code>عنوان [شناسه].en.srt</code> کنار ویدیو ساخته می‌شود.
          </div>
          {subFiles.length > 0 && (
            <div className="subsResult">
              <div className="subok">{subFiles.length} فایل زیرنویس ذخیره شد:</div>
              {subFiles.map((f, i) => (
                <a
                  key={"sf" + i}
                  className="subfile"
                  href={`${API}/api/jobs/${job.id}/files/${files.indexOf(f)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  🧩 {f.name}
                </a>
              ))}
            </div>
          )}
        </div>

        {/* پیشرفت عملیات */}
        {showDlCard && (
          <div className="card">
            <div className="dl-head">
              <div className="state">
                {jobActive && <span className="sp"></span>}
                <span>{stateTxt}</span>
              </div>
              <div className="pct">{pct.toFixed(pct >= 100 ? 0 : 1)}%</div>
            </div>
            <div className="bar">
              <i style={{ width: pct + "%" }}></i>
            </div>
            <div className="stats">
              <div className="stat">
                <b>سرعت</b>
                <span>{phase === "done" ? "—" : fmtSpeed(p.speed)}</span>
              </div>
              <div className="stat">
                <b>زمان باقی‌مانده</b>
                <span>{phase === "done" ? "—" : fmtEta(p.eta)}</span>
              </div>
              <div className="stat">
                <b>حجم</b>
                <span>
                  {p.total ? fmtSize(p.downloaded) + " / " + fmtSize(p.total) : fmtSize(p.downloaded)}
                </span>
              </div>
              <div className="stat">
                <b>قطعات (Fragments)</b>
                <span>{p.frag_n ? (p.frag_i || 0) + " / " + p.frag_n : "—"}</span>
              </div>
            </div>
            {p.file && (
              <div className="filename" title={p.file}>
                {p.file}
              </div>
            )}

            {files.length > 0 && (
              <div className="filelinks">
                {files.map((f, i) => (
                  <a
                    key={i}
                    className="filelink"
                    href={`${API}/api/jobs/${job.id}/files/${i}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <span className={"kind " + f.kind}>
                      {f.kind === "subtitle" ? "زیرنویس" : f.kind === "audio" ? "صدا" : "ویدیو"}
                    </span>
                    <span>{f.name}</span>
                    <span className="sz">{fmtSize(f.size)}</span>
                  </a>
                ))}
              </div>
            )}

            <div className="actions">
              {jobActive && (
                <button className="btn danger sm" onClick={doCancel}>
                  ✖ لغو عملیات
                </button>
              )}
              {phase === "done" && (
                <button className="btn ghost sm" onClick={() => setJob(null)}>
                  ✔ بستن کارت عملیات
                </button>
              )}
              <button
                className="btn ghost sm"
                onClick={() => {
                  setJob(null);
                  setSt(null);
                  setPickedKey("");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
              >
                ⬇️ دانلود کیفیت دیگر
              </button>
            </div>
          </div>
        )}

        {/* کنسول */}
        <div className="card">
          <div className="log-head">
            <div className="loghead-t">🖥 کنسول خروجي سرور</div>
            <button className="btn ghost sm" onClick={() => setLog([])}>
              پاک کردن
            </button>
          </div>
          <div className="logbox" ref={logBoxRef}>
            {log.map((line, i) => (
              <div key={i} className={logClass(line)}>
                {line}
              </div>
            ))}
          </div>
        </div>

        <footer>
          عملیات روی سرور اجرا می‌شود • فایل‌ها پس از پایان دانلود از لینک‌های بالا قابل دریافت هستند
          <br />
          دانلود ناتمام با فایل .part ادامه پیدا می‌کند؛ کافی است همان کیفیت را دوباره بزنید.
        </footer>
      </div>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={"toast " + t.type}>
            {t.msg}
          </div>
        ))}
      </div>
    </>
  );
}
