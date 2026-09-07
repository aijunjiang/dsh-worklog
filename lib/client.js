window.__ModuleLoader__.load({
	id: "dsh-worklog",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		//#region \0rolldown/runtime.js
		var __create = Object.create;
		var __defProp = Object.defineProperty;
		var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
		var __getOwnPropNames = Object.getOwnPropertyNames;
		var __getProtoOf = Object.getPrototypeOf;
		var __hasOwnProp = Object.prototype.hasOwnProperty;
		var __copyProps = (to, from, except, desc) => {
			if (from && typeof from === "object" || typeof from === "function") for (var keys = __getOwnPropNames(from), i = 0, n = keys.length, key; i < n; i++) {
				key = keys[i];
				if (!__hasOwnProp.call(to, key) && key !== except) __defProp(to, key, {
					get: ((k) => from[k]).bind(null, key),
					enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable
				});
			}
			return to;
		};
		var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", {
			value: mod,
			enumerable: true
		}) : target, mod));
		//#endregion
		let react = require("react");
		react = __toESM(react, 1);
		//#region src/client/index.ts
		/**
		* dsh-worklog 浏览器端：conversation.view 新增「工作台」页签。
		* 月历（会话量/分钟）→ 点选日期/区间 → 拉条目（勾选）→ 生成日报/周报/半年总结 markdown。
		* 与宿主通过 /dsh-worklog JSON-RPC 通道通信（client→host，仅 JSON）。
		* 纯 React.createElement，无 JSX / CSS 模块依赖。
		*/
		const inject = ["slots"];
		const WEEK_LABELS = [
			"一",
			"二",
			"三",
			"四",
			"五",
			"六",
			"日"
		];
		const KINDS = [
			{
				value: "daily",
				label: "日报"
			},
			{
				value: "weekly",
				label: "周报"
			},
			{
				value: "monthly",
				label: "月报"
			},
			{
				value: "halfyear",
				label: "半年总结"
			},
			{
				value: "custom",
				label: "自定义"
			}
		];
		const DEFAULT_OFF = 480;
		function pad2(n) {
			return n < 10 ? `0${n}` : String(n);
		}
		function localParts(ms, off) {
			const dt = new Date(ms + off * 6e4);
			return {
				y: dt.getUTCFullYear(),
				m: dt.getUTCMonth() + 1,
				d: dt.getUTCDate()
			};
		}
		function dayKey(y, m, d) {
			return `${y}-${pad2(m)}-${pad2(d)}`;
		}
		function todayLocal(off) {
			const { y, m, d } = localParts(Date.now(), off);
			return dayKey(y, m, d);
		}
		function firstDow(y, m) {
			return new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
		}
		function fmtMin(ms) {
			if (!ms) return "";
			const m = Math.round(ms / 6e4);
			if (m < 60) return `${m}m`;
			return `${Math.floor(m / 60)}h${pad2(m % 60)}m`;
		}
		function makeRpc(ctx) {
			return async (endpoint, payload) => {
				const connection = ctx.get("connection");
				if (!connection || !connection.rpc) throw new Error("无网络通道（connection）");
				const res = await connection.rpc.call("/dsh-worklog", endpoint, payload ?? {});
				if (!res.ok) throw new Error(res.error?.message || res.error?.code || "rpc failed");
				return res.value;
			};
		}
		function apply(ctx) {
			ctx.slots.inject("conversation.view", () => ctx.slots.register({
				name: "conversation.view",
				id: "worklog",
				order: 20,
				label: "工作台",
				inject: () => ({ rpc: makeRpc(ctx) })
			}, WorklogRoot));
			ctx.slots.inject("settings.plugin.item", () => ctx.slots.register({
				name: "settings.plugin.item",
				key: "dsh-worklog",
				inject: () => ({ rpc: makeRpc(ctx) })
			}, WorklogSettingsCard));
		}
		var WorklogBoundary = class extends react.Component {
			constructor(props) {
				super(props);
				this.state = { err: null };
			}
			static getDerivedStateFromError(e) {
				return { err: e && e.message ? e.message : String(e) };
			}
			componentDidCatch(e) {
				console.error("[dsh-worklog] render error", e);
			}
			render() {
				if (this.state.err) return react.createElement("div", { style: {
					padding: 16,
					color: "#ff6b6b",
					fontSize: 13
				} }, "工作台渲染出错：", this.state.err);
				return this.props.children;
			}
		};
		function WorklogRoot(props) {
			return react.createElement(WorklogBoundary, null, react.createElement(WorklogView, props));
		}
		const cellBase = {
			minHeight: 64,
			border: "1px solid rgba(127,127,127,.18)",
			borderRadius: 6,
			padding: 4,
			display: "flex",
			flexDirection: "column",
			gap: 2,
			cursor: "pointer",
			background: "transparent",
			color: "inherit",
			textAlign: "left",
			font: "inherit"
		};
		function WorklogView(props) {
			const rpc = props.rpc;
			const boot = localParts(Date.now(), DEFAULT_OFF);
			const [off, setOff] = react.useState(DEFAULT_OFF);
			const [ym, setYm] = react.useState({
				y: boot.y,
				m: boot.m
			});
			const [days, setDays] = react.useState({});
			const [sel, setSel] = react.useState({});
			const [items, setItems] = react.useState([]);
			const [checked, setChecked] = react.useState(/* @__PURE__ */ new Set());
			const [expanded, setExpanded] = react.useState(/* @__PURE__ */ new Set());
			const [kind, setKind] = react.useState("daily");
			const [report, setReport] = react.useState(null);
			const [error, setError] = react.useState(null);
			const [busy, setBusy] = react.useState(false);
			const loadMonth = react.useCallback(async (y, m) => {
				setError(null);
				setBusy(true);
				try {
					const r = await rpc("month", {
						year: y,
						month: m
					});
					if (typeof r.offsetMinutes === "number") setOff(r.offsetMinutes);
					setDays(r.days || {});
				} catch (e) {
					setError(String(e?.message || e));
				} finally {
					setBusy(false);
				}
			}, [rpc]);
			react.useEffect(() => {
				loadMonth(ym.y, ym.m);
			}, [ym, loadMonth]);
			const fetchItems = react.useCallback(async (from, to) => {
				setError(null);
				setBusy(true);
				try {
					setItems((await rpc("range", {
						from,
						to
					})).items || []);
				} catch (e) {
					setError(String(e?.message || e));
				} finally {
					setBusy(false);
				}
			}, [rpc]);
			const pick = (date) => {
				setReport(null);
				setSel((s) => {
					if (!s.from) return { from: date };
					if (!s.to) {
						const ns = {
							from: s.from,
							to: date
						};
						if (ns.from <= ns.to) fetchItems(ns.from, ns.to);
						else return {};
						return ns;
					}
					return { from: date };
				});
			};
			const toggle = (id) => {
				setChecked((c) => {
					const n = new Set(c);
					if (n.has(id)) n.delete(id);
					else n.add(id);
					return n;
				});
			};
			const selectAll = () => {
				const ids = items.map((it) => it.sessionId);
				setChecked((c) => {
					return ids.every((id) => c.has(id)) ? /* @__PURE__ */ new Set() : new Set(ids);
				});
			};
			const toggleExpand = (id) => {
				setExpanded((c) => {
					const n = new Set(c);
					if (n.has(id)) n.delete(id);
					else n.add(id);
					return n;
				});
			};
			const genReport = async () => {
				if (!sel.from) return;
				const to = sel.to || sel.from;
				setBusy(true);
				setError(null);
				try {
					const includeIds = checked.size ? [...checked] : null;
					setReport((await rpc("report", {
						from: sel.from,
						to,
						kind,
						includeIds
					})).markdown);
				} catch (e) {
					setError(String(e?.message || e));
				} finally {
					setBusy(false);
				}
			};
			const rescan = async () => {
				setBusy(true);
				setError(null);
				try {
					const r = await rpc("rescan");
					setReport(`重扫完成：收录 ${r.kept} 条，补摘要 ${r.summarized} 条。\n\n${report || ""}`);
					await loadMonth(ym.y, ym.m);
					if (sel.from) await fetchItems(sel.from, sel.to || sel.from);
				} catch (e) {
					setError(String(e?.message || e));
				} finally {
					setBusy(false);
				}
			};
			const summarizeNow = async () => {
				if (!sel.from) return;
				setBusy(true);
				setError(null);
				try {
					setReport(`已按节点切片生成摘要 ${(await rpc("summarize-now")).summarized} 条。\n\n${report || ""}`);
					await loadMonth(ym.y, ym.m);
					await fetchItems(sel.from, sel.to || sel.from);
				} catch (e) {
					setError(String(e?.message || e));
				} finally {
					setBusy(false);
				}
			};
			const lead = (firstDow(ym.y, ym.m) + 6) % 7;
			const daysInMonth = new Date(Date.UTC(ym.y, ym.m, 0)).getUTCDate();
			const cells = [];
			for (let i = 0; i < 42; i++) {
				const dayNum = i - lead + 1;
				cells.push({
					key: String(i),
					d: dayNum,
					inMonth: dayNum >= 1 && dayNum <= daysInMonth
				});
			}
			const today = todayLocal(off);
			const header = {
				display: "flex",
				alignItems: "center",
				gap: 8,
				marginBottom: 8,
				flexWrap: "wrap"
			};
			const grid = {
				display: "grid",
				gridTemplateColumns: "repeat(7, 1fr)",
				gap: 4
			};
			const weekCell = {
				textAlign: "center",
				fontSize: 12,
				opacity: .7,
				padding: 2
			};
			const rangeSel = {
				fontSize: 13,
				opacity: .9,
				margin: "4px 0 8px",
				display: "flex",
				gap: 8,
				alignItems: "center",
				flexWrap: "wrap"
			};
			const badgeRow = {
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center"
			};
			const badge = {
				fontSize: 11,
				fontWeight: 700,
				opacity: .85
			};
			const minLabel = {
				fontSize: 10,
				opacity: .6
			};
			const btn = {
				border: "1px solid rgba(127,127,127,.35)",
				borderRadius: 6,
				padding: "2px 8px",
				background: "transparent",
				color: "inherit",
				cursor: "pointer",
				fontSize: 13
			};
			const btnPrimary = {
				...btn,
				borderColor: "rgba(80,140,255,.8)",
				color: "#5a9cff"
			};
			const row = {
				display: "flex",
				gap: 10,
				alignItems: "flex-start",
				padding: "6px 4px",
				borderBottom: "1px solid rgba(127,127,127,.15)"
			};
			const title = `${ym.y} 年 ${ym.m} 月`;
			return react.createElement("div", { style: {
				padding: 12,
				overflow: "auto",
				height: "100%"
			} }, react.createElement("div", { style: header }, react.createElement("button", {
				style: btn,
				onClick: () => setYm((s) => ({
					y: s.m === 1 ? s.y - 1 : s.y,
					m: s.m === 1 ? 12 : s.m - 1
				}))
			}, "‹"), react.createElement("button", {
				style: btn,
				onClick: () => setYm((s) => ({
					y: s.m === 12 ? s.y + 1 : s.y,
					m: s.m === 12 ? 1 : s.m + 1
				}))
			}, "›"), react.createElement("span", { style: { fontWeight: 700 } }, title), react.createElement("button", {
				style: btn,
				onClick: () => {
					const t = localParts(Date.now(), off);
					setYm({
						y: t.y,
						m: t.m
					});
				}
			}, "今天"), react.createElement("button", {
				style: btn,
				onClick: () => void rescan(),
				disabled: busy
			}, "刷新"), busy && react.createElement("span", { style: {
				opacity: .6,
				fontSize: 12
			} }, "加载中…"), error && react.createElement("span", { style: {
				color: "#f66",
				fontSize: 12
			} }, error)), react.createElement("div", { style: rangeSel }, react.createElement("span", null, sel.from ? `已选：${sel.from}${sel.to ? ` ~ ${sel.to}` : "（再点一天结束区间）"}` : "点击日期查看当天，或选起止两天做区间"), react.createElement("button", {
				style: btn,
				onClick: () => {
					setSel({});
					setItems([]);
					setReport(null);
				}
			}, "清空")), react.createElement("div", { style: grid }, WEEK_LABELS.map((w) => react.createElement("div", {
				key: w,
				style: weekCell
			}, w)), cells.map((c) => {
				if (!c.inMonth) return react.createElement("div", {
					key: c.key,
					style: { minHeight: 64 }
				});
				const date = dayKey(ym.y, ym.m, c.d);
				const info = days[date];
				const active = sel.from === date || sel.to === date;
				const inRange = sel.from && sel.to && date >= sel.from && date <= sel.to;
				const isToday = date === today;
				const style = {
					...cellBase,
					borderColor: isToday ? "rgba(90,156,255,.9)" : active ? "rgba(90,156,255,.65)" : void 0,
					background: inRange ? "rgba(90,156,255,.12)" : info ? "rgba(90,200,120,.10)" : "transparent"
				};
				return react.createElement("button", {
					key: c.key,
					style,
					onClick: () => pick(date)
				}, react.createElement("div", { style: badgeRow }, react.createElement("span", null, c.d), info && react.createElement("span", { style: badge }, `${info.sessions} 会话`)), info && react.createElement("span", { style: minLabel }, fmtMin(info.minutesMs)));
			})), react.createElement("div", { style: {
				display: "flex",
				gap: 8,
				alignItems: "center",
				margin: "10px 0"
			} }, react.createElement("span", { style: {
				fontSize: 13,
				opacity: .8
			} }, "生成："), react.createElement("select", {
				value: kind,
				onChange: (e) => setKind(e.target.value),
				style: btn
			}, KINDS.map((k) => react.createElement("option", {
				key: k.value,
				value: k.value
			}, k.label))), react.createElement("button", {
				style: btnPrimary,
				onClick: () => void genReport(),
				disabled: !sel.from || busy
			}, "生成报告"), react.createElement("button", {
				style: btn,
				onClick: () => void summarizeNow(),
				disabled: !sel.from || busy
			}, "生成摘要（节点切片）"), items.length > 0 && react.createElement("button", {
				style: btn,
				onClick: selectAll
			}, "全选/全不选"), checked.size > 0 && react.createElement("span", { style: {
				fontSize: 12,
				opacity: .7
			} }, `已勾选 ${checked.size} 条`)), items.length === 0 ? react.createElement("div", { style: {
				opacity: .55,
				fontSize: 13,
				padding: 8
			} }, "（该日/区间暂无工作条目；数据由宿主自动扫描会话生成）") : react.createElement("div", null, items.map((it) => {
				const cross = it.spanDayCount > 1 ? "（跨天）" : "";
				const nodes = (it.nodes || []).filter((n) => n.summary && n.summary.text);
				const isOpen = expanded.has(it.sessionId);
				const tagSet = /* @__PURE__ */ new Set();
				for (const n of nodes) for (const t of n.summary.tags || []) tagSet.add(t);
				if (!tagSet.size && it.summary) for (const t of it.summary.tags || []) tagSet.add(t);
				const tags = [...tagSet].map((t) => `#${t}`).join(" ");
				return react.createElement("div", {
					key: it.sessionId,
					style: row
				}, react.createElement("input", {
					type: "checkbox",
					checked: checked.has(it.sessionId),
					onChange: () => toggle(it.sessionId)
				}), react.createElement("div", { style: {
					flex: 1,
					minWidth: 0
				} }, react.createElement("div", { style: {
					display: "flex",
					alignItems: "center",
					gap: 8
				} }, react.createElement("strong", null, it.title || it.sessionId.slice(0, 12)), react.createElement("span", { style: {
					fontSize: 12,
					opacity: .7
				} }, `${it.startClock}–${it.endClock} · ${fmtMin(it.durationMs)} ${cross} · ${it.cwdLabel}`), nodes.length > 0 && react.createElement("button", {
					style: {
						...btn,
						padding: "1px 6px",
						fontSize: 11,
						border: "none",
						color: "var(--dsw-alias-label-secondary)"
					},
					onClick: () => toggleExpand(it.sessionId)
				}, isOpen ? "收起 ▾" : `展开 ${nodes.length} 个节点 ▸`)), isOpen && nodes.length > 0 ? react.createElement("div", { style: {
					marginTop: 4,
					display: "flex",
					flexDirection: "column",
					gap: 3
				} }, nodes.map((n, i) => react.createElement("div", {
					key: i,
					style: {
						fontSize: 12,
						opacity: .85
					}
				}, react.createElement("span", { style: {
					opacity: .55,
					marginRight: 6
				} }, `${n.startClock}–${n.endClock}`), n.summary.text))) : !nodes.length && it.summary && it.summary.text && react.createElement("div", { style: {
					fontSize: 12,
					opacity: .85,
					marginTop: 2
				} }, it.summary.text), tags && react.createElement("div", { style: {
					fontSize: 11,
					opacity: .6,
					marginTop: 2
				} }, tags)));
			})), report !== null && react.createElement("div", { style: { marginTop: 12 } }, react.createElement("div", { style: {
				display: "flex",
				gap: 8,
				alignItems: "center",
				marginBottom: 6
			} }, react.createElement("strong", null, "报告预览"), react.createElement("button", {
				style: btnPrimary,
				onClick: () => {
					navigator.clipboard?.writeText(report).catch(() => void 0);
				}
			}, "复制")), react.createElement("pre", { style: {
				whiteSpace: "pre-wrap",
				background: "rgba(127,127,127,.08)",
				borderRadius: 8,
				padding: 10,
				fontSize: 13,
				maxHeight: 420,
				overflow: "auto",
				margin: 0
			} }, report)));
		}
		const WL_CSS = {
			card: {
				listStyle: "none",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: "12px",
				background: "var(--dsw-alias-bg-layer-3)",
				transition: "border-color .16s, background .16s"
			},
			cardOpen: {
				background: "var(--dsw-alias-bg-layer-2)",
				borderColor: "var(--dsw-alias-label-dimmed)"
			},
			header: {
				width: "100%",
				appearance: "none",
				border: "0",
				background: "none",
				font: "inherit",
				color: "inherit",
				textAlign: "left",
				cursor: "pointer",
				display: "flex",
				alignItems: "center",
				gap: "12px",
				padding: "14px 16px",
				borderRadius: "12px",
				outlineOffset: "-2px",
				boxSizing: "border-box"
			},
			headText: {
				flex: "1",
				minWidth: "0",
				display: "flex",
				flexDirection: "column",
				gap: "4px"
			},
			name: {
				fontSize: "15px",
				fontWeight: 600,
				lineHeight: "1.4",
				color: "var(--dsw-alias-label-primary)"
			},
			description: {
				fontSize: "13px",
				lineHeight: "1.5",
				color: "var(--dsw-alias-label-tertiary)"
			},
			pill: {
				flex: "none",
				borderRadius: "999px",
				padding: "1px 8px",
				fontSize: "11px",
				lineHeight: "17px",
				fontWeight: 500,
				whiteSpace: "nowrap",
				background: "var(--dsw-alias-bg-module-platform)",
				color: "var(--dsw-alias-label-secondary)"
			},
			pillOk: { color: "var(--dsw-alias-label-success, #16a34a)" },
			pillEmpty: { color: "var(--dsw-alias-label-tertiary, #888)" },
			chevron: {
				flex: "none",
				color: "var(--dsw-alias-label-tertiary)",
				transition: "transform .16s"
			},
			chevronOpen: { transform: "rotate(180deg)" },
			body: {
				borderTop: "1px solid var(--dsw-alias-border-l2)",
				margin: "0 16px",
				paddingBottom: "8px"
			},
			field: {
				display: "flex",
				flexDirection: "column",
				gap: "6px",
				padding: "12px 0",
				borderBottom: "1px solid var(--dsw-alias-border-l2)"
			},
			fieldHead: {
				display: "flex",
				alignItems: "center",
				gap: "8px"
			},
			label: {
				minWidth: "0",
				color: "var(--dsw-alias-label-primary)",
				flex: "1",
				fontSize: "13px",
				fontWeight: 500,
				lineHeight: "1.5"
			},
			input: {
				border: "1px solid var(--dsw-alias-border-l2)",
				background: "var(--dsw-alias-bg-layer-3)",
				height: "34px",
				font: "inherit",
				color: "var(--dsw-alias-label-primary)",
				borderRadius: "8px",
				padding: "0 12px",
				fontSize: "13px",
				lineHeight: "1.5",
				boxSizing: "border-box",
				width: "100%"
			},
			hint: {
				color: "var(--dsw-alias-label-tertiary)",
				margin: "0",
				fontSize: "12px",
				lineHeight: "1.5"
			},
			footer: {
				display: "flex",
				alignItems: "center",
				gap: "8px",
				padding: "12px 0 4px"
			},
			footerLeft: {
				flex: "1",
				minWidth: "0",
				display: "flex",
				gap: "8px",
				alignItems: "center"
			},
			ok: {
				margin: "0",
				fontSize: "12px",
				lineHeight: "1.5",
				color: "var(--dsw-alias-label-success, #16a34a)"
			},
			failed: {
				margin: "0",
				fontSize: "12px",
				lineHeight: "1.5",
				color: "var(--dsw-alias-label-error)"
			},
			btn: {
				appearance: "none",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: "8px",
				padding: "5px 14px",
				font: "inherit",
				fontSize: "13px",
				lineHeight: "1.5",
				cursor: "pointer",
				background: "none",
				color: "var(--dsw-alias-label-secondary)"
			},
			btnPrimary: {
				background: "var(--dsw-alias-label-primary)",
				color: "var(--dsw-alias-bg-layer-3)",
				borderColor: "transparent"
			},
			btnDisabled: {
				opacity: "0.4",
				cursor: "default"
			},
			checkRow: {
				display: "flex",
				alignItems: "center",
				gap: "8px",
				padding: "12px 0"
			}
		};
		function wlMerge(a, b) {
			return Object.assign({}, a, b || void 0);
		}
		function WorklogSettingsCard(props) {
			const rpc = props.rpc;
			const [open, setOpen] = react.useState(false);
			const [apiFormat, setApiFormat] = react.useState("dsh");
			const [baseUrl, setBaseUrl] = react.useState("");
			const [apiKey, setApiKey] = react.useState("");
			const [modelName, setModelName] = react.useState("");
			const [context, setContext] = react.useState("");
			const [prompt, setPrompt] = react.useState("");
			const [defaultPrompt, setDefaultPrompt] = react.useState("");
			const [proactive, setProactive] = react.useState(true);
			const [msg, setMsg] = react.useState("");
			const [msgOk, setMsgOk] = react.useState(true);
			const [busy, setBusy] = react.useState(false);
			react.useEffect(() => {
				let live = true;
				(async () => {
					try {
						const v = await rpc("settings.get");
						if (!live) return;
						setApiFormat(v.apiFormat || "dsh");
						setBaseUrl(v.baseUrl || "");
						setApiKey(v.apiKey || "");
						setModelName(v.modelName || "");
						setContext(v.context ? String(v.context) : "");
						setPrompt(v.prompt || "");
						setDefaultPrompt(typeof v.defaultPrompt === "string" ? v.defaultPrompt : "");
						setProactive(v.proactive !== false);
					} catch (e) {
						if (live) {
							setMsg(String(e?.message || e));
							setMsgOk(false);
						}
					}
				})();
				return () => {
					live = false;
				};
			}, [rpc]);
			const configured = apiFormat === "dsh" ? true : !!(modelName && baseUrl);
			const pill = (extra, text) => react.createElement("span", { style: wlMerge(WL_CSS.pill, extra) }, text);
			const chevron = () => react.createElement("span", { style: wlMerge(WL_CSS.chevron, open ? WL_CSS.chevronOpen : null) }, "▾");
			const field = (label, node, hint) => react.createElement("div", { style: WL_CSS.field }, react.createElement("div", { style: WL_CSS.fieldHead }, react.createElement("span", { style: WL_CSS.label }, label)), node, hint ? react.createElement("p", { style: WL_CSS.hint }, hint) : null);
			const save = async () => {
				setBusy(true);
				setMsg("");
				try {
					await rpc("settings.set", {
						apiFormat,
						baseUrl,
						apiKey,
						modelName,
						context: context === "" ? 0 : Number(context) || 0,
						prompt,
						proactive
					});
					setMsg("已保存");
					setMsgOk(true);
				} catch (e) {
					setMsg("保存失败：" + String(e?.message || e));
					setMsgOk(false);
				} finally {
					setBusy(false);
				}
			};
			const rescan = async () => {
				setBusy(true);
				setMsg("");
				try {
					setMsg(`已按节点切片重摘要 ${(await rpc("summarize-now")).summarized} 条`);
					setMsgOk(true);
				} catch (e) {
					setMsg("重摘要失败：" + String(e?.message || e));
					setMsgOk(false);
				} finally {
					setBusy(false);
				}
			};
			const external = apiFormat !== "dsh";
			return react.createElement("li", { style: wlMerge(WL_CSS.card, open ? WL_CSS.cardOpen : null) }, react.createElement("button", {
				style: WL_CSS.header,
				onClick: () => setOpen((v) => !v),
				"aria-expanded": open
			}, react.createElement("div", { style: WL_CSS.headText }, react.createElement("span", { style: WL_CSS.name }, "工作日志"), react.createElement("span", { style: WL_CSS.description }, "按对话节点切片、自动生成工作摘要")), pill(configured ? WL_CSS.pillOk : WL_CSS.pillEmpty, configured ? "已配置" : "未配置"), chevron()), open && react.createElement("div", { style: WL_CSS.body }, field("模型接口格式", react.createElement("select", {
				style: WL_CSS.input,
				value: apiFormat,
				onChange: (e) => setApiFormat(e.target.value)
			}, react.createElement("option", { value: "dsh" }, "DSH 内置（默认模型）"), react.createElement("option", { value: "openai" }, "OpenAI 兼容"), react.createElement("option", { value: "anthropic" }, "Anthropic"))), external && field("Base URL", react.createElement("input", {
				style: WL_CSS.input,
				value: baseUrl,
				placeholder: "https://api.openai.com/v1",
				onChange: (e) => setBaseUrl(e.target.value)
			})), external && field("API Key", react.createElement("input", {
				style: WL_CSS.input,
				type: "password",
				value: apiKey,
				placeholder: "sk-...（留空则读环境变量 GJSL_API_KEY）",
				onChange: (e) => setApiKey(e.target.value)
			}), "保存在本机设置，界面不回显；留空则回退环境变量/凭据库 GJSL_API_KEY"), external && field("Model Name", react.createElement("input", {
				style: WL_CSS.input,
				value: modelName,
				placeholder: "gpt-4o-mini / claude-3-5-sonnet",
				onChange: (e) => setModelName(e.target.value)
			})), field("上下文窗口（tokens）", react.createElement("input", {
				style: WL_CSS.input,
				value: context,
				placeholder: "如 985657，0 = 自动",
				onChange: (e) => setContext(e.target.value)
			}), "输入上下文窗口大小（不影响输出上限）"), field("摘要 Prompt", react.createElement("div", null, react.createElement("textarea", {
				style: {
					...WL_CSS.input,
					height: 96,
					resize: "vertical",
					padding: "8px 12px"
				},
				value: prompt,
				placeholder: defaultPrompt,
				onChange: (e) => setPrompt(e.target.value)
			}), react.createElement("div", { style: {
				display: "flex",
				gap: 8,
				alignItems: "center",
				marginTop: 6
			} }, react.createElement("button", {
				style: WL_CSS.btn,
				onClick: () => setPrompt(defaultPrompt)
			}, "填入默认提示词"), react.createElement("span", { style: WL_CSS.hint }, "留空 = 使用内置提示词（见上方灰字）")))), react.createElement("label", { style: WL_CSS.checkRow }, react.createElement("input", {
				type: "checkbox",
				checked: proactive,
				onChange: (e) => setProactive(e.target.checked)
			}), react.createElement("span", { style: WL_CSS.label }, "主动模式（每个有新活动的日期都即时补摘要）")), react.createElement("div", { style: WL_CSS.footer }, react.createElement("div", { style: WL_CSS.footerLeft }, react.createElement("button", {
				style: wlMerge(WL_CSS.btn, busy ? WL_CSS.btnDisabled : null),
				onClick: () => void save(),
				disabled: busy
			}, "保存"), react.createElement("button", {
				style: wlMerge(WL_CSS.btn, WL_CSS.btnPrimary, busy ? WL_CSS.btnDisabled : null),
				onClick: () => void rescan(),
				disabled: busy
			}, "立即重新总结")), msg && react.createElement("p", { style: msgOk ? WL_CSS.ok : WL_CSS.failed }, msg))));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

//# sourceMappingURL=client.js.map