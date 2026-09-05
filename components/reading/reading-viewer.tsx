"use client";

import { useState, useEffect, useRef, useCallback, useMemo, useLayoutEffect } from "react";
import { BookOpenText, Bot, ChevronDown, ChevronRight, Languages, Menu, Minus, PenLine, SendHorizontal, Settings2, X } from "lucide-react";
import {
    loadChapters,
    loadProgress,
    saveProgress,
    loadAnnotations,
    saveAnnotations,
    saveAnnotation,
    deleteAnnotation,
    saveChapters,
    loadRawFileBlob,
    updateBook,
    loadReadingInteractionConfig,
    saveReadingInteractionConfig,
    DEFAULT_READING_INTERACTION_CONFIG,
} from "@/lib/reading-storage";
import { generateAnnotationBatch, generateReadingChat, parseReadingDiscussResponse, type ReadingDiscussAction, type ReadingDiscussContext } from "@/lib/reading-engine";
import { loadChatMessages, pushChatMessage, deleteChatMessage, editChatMessage, loadChatContacts, loadChatSessions, saveChatSessions, CHAT_MESSAGE_PUSHED_EVENT, CHAT_MESSAGES_DELETED_EVENT } from "@/lib/chat-storage";
import type { ChatMessage, ChatSession } from "@/lib/chat-storage";
import { loadCharacters } from "@/lib/character-storage";
import { parseAIResponse } from "@/lib/rich-message-parser";
import { MessageBubble } from "@/components/chat/message-bubble";
import { ContentDialog } from "@/components/ui/modal";
import { Toggle } from "@/components/ui/form";
import { PdfPageRenderer } from "./reading-pdf-viewer";
import { decodeTxtArrayBuffer, parsePdfPageRange, PDF_PAGES_PER_CHAPTER, parseTxtContent, parseEpubFile } from "@/lib/reading-parser";
import type { Book, BookChapter, ReadingAnnotation, ReadingProgress } from "@/lib/reading-types";
import { kvGet, kvSet } from "@/lib/kv-db";
import type { Character } from "@/lib/character-types";
import { splitBilingualText } from "@/lib/bilingual-text";
import { getReadingRemoteBook, getReadingSource } from "@/lib/reading-source";
import { createDeviceId, getRemoteBook, getShushanChapterContent, loadShushanAccount } from "@/lib/shushan-client";
import { getGenericChapterContent, htmlToParagraphs, type GenericSourceChapter } from "@/lib/reading-source-engine";

/**
 * 过滤系统级内容：移除 XML 标签、系统指令等不应展示给用户的内容。
 * 防止 <action_result>、<system> 等标签和系统提示泄露到聊天界面。
 * 此函数在保存时和渲染时都会调用，确保已存储的旧消息也能被清理。
 * 全部包裹在 try-catch 中，确保任何正则错误都不会崩溃组件。
 */
function filterSystemContent(text: string): string {
    if (!text || typeof text !== "string") return "";
    try {
        let cleaned = text;
        // 移除所有 XML/HTML 风格的标签及其内容（系统级标签）
        const systemTags = [
            "action_result", "action", "system", "instruction",
            "tool_call", "function_call", "tool_result", "memory_write",
            "tool_use", "memory_request", "function_result",
        ];
        for (const tag of systemTags) {
            try {
                const pairRe = new RegExp(`<${tag}[^>]*>[\\s\\S]*?</${tag}>`, "gi");
                cleaned = cleaned.replace(pairRe, "");
                const openRe = new RegExp(`<${tag}[^>]*>`, "gi");
                cleaned = cleaned.replace(openRe, "");
                const closeRe = new RegExp(`</${tag}>`, "gi");
                cleaned = cleaned.replace(closeRe, "");
            } catch { /* 跳过单个标签的错误 */ }
        }
        // 移除其他常见的系统标签对
        const otherSystemTags = ["result", "response", "output", "error", "status"];
        for (const tag of otherSystemTags) {
            try {
                const pairRe = new RegExp(`<(${tag})[^>]*>[\\s\\S]*?</\\1>`, "gi");
                cleaned = cleaned.replace(pairRe, "");
                const standaloneRe = new RegExp(`</?${tag}[^>]*>`, "gi");
                cleaned = cleaned.replace(standaloneRe, "");
            } catch { /* 跳过 */ }
        }
        // 移除残留的自闭合或未闭合系统标签
        cleaned = cleaned.replace(/<\/?(?:action_result|action|system|instruction|tool_call|function_call|tool_result|memory_write|tool_use|memory_request|function_result|result|response|output|error|status)[^>]*\/?>/gi, "");
        // 移除系统提示语
        cleaned = cleaned.replace(/以下是系统处理结果[：:].*?(?=\n|$)/gs, "");
        cleaned = cleaned.replace(/请基于以上结果[，,].*?(?:角色身份|继续|回复)[^。]*。/gs, "");
        cleaned = cleaned.replace(/不要重复你之前已经[说做]过[^。]*。/g, "");
        cleaned = cleaned.replace(/不要再次执行相同的动作[^。]*。/g, "");
        cleaned = cleaned.replace(/请以.*?角色.*?身份.*?(?:回复|继续)[^。]*。/gs, "");
        cleaned = cleaned.replace(/系统提示[：:].*?(?=\n\n|\n(?=[^\s])|$)/gs, "");
        cleaned = cleaned.replace(/\[系统\].*?(?=\n\n|\n(?=[^\s])|$)/g, "");
        // 清理多余空行和前后空白
        cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
        return cleaned;
    } catch {
        // 如果过滤过程出错，返回原始文本（不崩溃组件）
        return text || "";
    }
}

type TxtPageItem =
    | { kind: "line"; text: string; chapterIndex: number; paragraphIndex: number; indent?: boolean; segEnd?: boolean }
    | { kind: "gap"; chapterIndex: number; paragraphIndex: number }
    | { kind: "annotation"; annotation: ReadingAnnotation; chapterIndex: number; paragraphIndex: number };

type ParagraphRef = {
    absoluteIndex: number;
    chapterIndex: number;
    paragraphIndex: number;
    text: string;
    pageNum?: number;
    yRatio?: number;
};

type AnnotationBatchRequest = {
    key: string;
    title: string;
    size: number;
    items: ParagraphRef[];
};

type AnnotationDialogMode = "manual" | "auto";
type AnnotationBatchMode = AnnotationDialogMode | "auto-current";

const DISCUSS_TARGET_CHARS = 1000;
const DISCUSS_MIN_CHARS = 700;
const DISCUSS_MAX_CHARS = 1600;
const DISCUSS_MAX_PARAGRAPHS = 16;

function toCanvasFont(style: CSSStyleDeclaration): string {
    return [
        style.fontStyle,
        style.fontVariant,
        style.fontWeight,
        style.fontSize,
        style.fontFamily,
    ].join(" ");
}

function formatParagraphRangeLabel(start: number, end: number): string {
    return start === end ? `第${start + 1}段` : `第${start + 1}-${end + 1}段`;
}

function getParagraphLength(text: string): number {
    return text.replace(/\s+/g, "").length || text.trim().length;
}

function buildPdfChunkTitle(startPage: number, endPage: number): string {
    return `第${startPage}-${endPage}页`;
}

function buildParagraphRefsFromChapters(chapters: BookChapter[]): ParagraphRef[] {
    const refs: ParagraphRef[] = chapters.flatMap((chapter, currentChapterIndex) =>
        chapter.paragraphs.map((text, paragraphIndex) => ({
            absoluteIndex: 0,
            chapterIndex: currentChapterIndex,
            paragraphIndex,
            text,
            pageNum: chapter.paragraphPages?.[paragraphIndex],
            yRatio: chapter.paragraphYPositions?.[paragraphIndex],
        })),
    );

    for (let i = 0; i < refs.length; i += 1) {
        refs[i].absoluteIndex = i;
    }

    return refs;
}

function trimTrailingGaps(items: TxtPageItem[]): TxtPageItem[] {
    let end = items.length;
    while (end > 0 && items[end - 1]?.kind === "gap") end -= 1;
    return items.slice(0, end);
}

function wrapTextToLines(text: string, maxWidth: number, ctx: CanvasRenderingContext2D, firstLineOffset = 0): string[] {
    if (!text) return [""];

    const lines: string[] = [];
    let current = "";
    let lineIndex = 0;

    for (const char of Array.from(text)) {
        const candidate = current + char;
        const lineLimit = lineIndex === 0 ? Math.max(1, maxWidth - firstLineOffset) : maxWidth;
        if (current && ctx.measureText(candidate).width > lineLimit) {
            lines.push(current);
            current = char;
            lineIndex += 1;
        } else {
            current = candidate;
        }
    }

    if (current) lines.push(current);
    return lines.length > 0 ? lines : [""];
}

function ReadingLoadingView({
    title,
    subtitle,
    compact = false,
    overlay = false,
}: {
    title: string;
    subtitle: string;
    compact?: boolean;
    overlay?: boolean;
}) {
    return (
        <div
            className={`reading-loading-view${compact ? " reading-loading-view--compact" : ""}${overlay ? " reading-loading-view--overlay" : ""}`}
            data-no-nav="true"
        >
            <div className="reading-loading-mark" aria-hidden="true">
                <span className="reading-loading-page reading-loading-page--back" />
                <span className="reading-loading-page reading-loading-page--middle" />
                <span className="reading-loading-page reading-loading-page--front" />
            </div>
            <div className="reading-loading-copy">
                <span className="reading-loading-title">
                    {title}
                    <span className="reading-loading-dots" aria-hidden="true"><i /><i /><i /></span>
                </span>
                <span className="reading-loading-subtitle">{subtitle}</span>
            </div>
            <div className="reading-loading-lines" aria-hidden="true">
                <span />
                <span />
                <span />
            </div>
        </div>
    );
}

function ReadingAnnotationContent({
    text,
    bilingualEnabled,
    expanded,
    onToggle,
}: {
    text: string;
    bilingualEnabled: boolean;
    expanded: boolean;
    onToggle: () => void;
}) {
    const bilingual = bilingualEnabled ? splitBilingualText(text) : null;
    if (!bilingual) {
        return <div className="reading-annotation-text">{text}</div>;
    }

    return (
        <div className="reading-annotation-text">
            <div>{bilingual.original}</div>
            <button
                type="button"
                className="chat-bilingual-toggle reading-annotation-bilingual-toggle"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onPointerCancel={(e) => e.stopPropagation()}
                onClick={(e) => {
                    e.stopPropagation();
                    onToggle();
                }}
                aria-expanded={expanded}
            >
                {expanded ? "收起中文" : "中文"}
            </button>
            {expanded && <div className="reading-annotation-translation">{bilingual.translated}</div>}
        </div>
    );
}

type Props = {
    book: Book;
    onBack: () => void;
};

function MangaImage({ url }: { url: string }) {
    const [src, setSrc] = useState(url);
    const objectUrlRef = useRef<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        const load = async () => {
            try {
                const response = await fetch("/api/reading/source", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        url,
                        asset: true,
                        timeoutMs: 20000,
                        headers: { Referer: "https://guiwb.nnmh.info/" },
                    }),
                });
                if (!response.ok) return;
                const blob = await response.blob();
                if (!blob.size || cancelled) return;
                const objectUrl = URL.createObjectURL(blob);
                objectUrlRef.current = objectUrl;
                setSrc(objectUrl);
            } catch {
                // 代理失败时保留原图地址作为回退。
            }
        };
        void load();
        return () => {
            cancelled = true;
            if (objectUrlRef.current) {
                URL.revokeObjectURL(objectUrlRef.current);
                objectUrlRef.current = null;
            }
        };
    }, [url]);

    return (
        <div className="reading-manga-image-wrap" data-no-nav="true">
            <img
                className="reading-manga-image"
                src={src}
                alt=""
                loading="lazy"
                referrerPolicy="no-referrer"
            />
        </div>
    );
}

export function ReadingViewer({ book, onBack }: Props) {
    const isPdf = book.format === "pdf";
    const isManga = (book as Book & { readerType?: string }).readerType === "manga";
    const [readingConfig, setReadingConfig] = useState(() => loadReadingInteractionConfig());
    const [chapters, setChapters] = useState<BookChapter[]>([]);
    const [chapterIndex, setChapterIndex] = useState(0);
    const [pdfCurrentPage, setPdfCurrentPage] = useState(1);
    const [pdfTotalPages, setPdfTotalPages] = useState(0);
    const [txtPage, setTxtPage] = useState(0);
    const [readingMode, setReadingMode] = useState<"continuous" | "page">("continuous");
    const [readingMargin, setReadingMargin] = useState(24);
    const [sharedLayout, setSharedLayout] = useState(false);
    const [annotations, setAnnotations] = useState<ReadingAnnotation[]>([]);
    const [generating, setGenerating] = useState(false);
    const [companionId, setCompanionId] = useState<string | null>(null);
    const [immersive, setImmersive] = useState(true);
    const [showCharPicker, setShowCharPicker] = useState(false);
    const [charPickerClosing, setCharPickerClosing] = useState(false);
    const closeCharPicker = useCallback(() => {
        if (!showCharPicker || charPickerClosing) return;
        setCharPickerClosing(true);
        setTimeout(() => { setShowCharPicker(false); setCharPickerClosing(false); }, 180);
    }, [showCharPicker, charPickerClosing]);
    const [showChat, setShowChat] = useState(false);
    const [chatExpanded, setChatExpanded] = useState(false);
    const [chatOffset, setChatOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [chatInput, setChatInput] = useState("");
    const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
    const [chatting, setChatting] = useState(false);
    const [autoAnnotate, setAutoAnnotate] = useState(false);
    const [annotationBatchSize, setAnnotationBatchSize] = useState(isPdf ? 5 : 50);
    const [annotationBatchInput, setAnnotationBatchInput] = useState(String(isPdf ? 5 : 50));
    const [annotationDialogMode, setAnnotationDialogMode] = useState<AnnotationDialogMode | null>(null);
    const [showReadingSettings, setShowReadingSettings] = useState(false);
    const [showReadingInterface, setShowReadingInterface] = useState(false);
    const [showNavigationDialog, setShowNavigationDialog] = useState(false);
    const [pdfJumpPage, setPdfJumpPage] = useState<number | undefined>(undefined);
    const [chaptersLoaded, setChaptersLoaded] = useState(false);
    const [remoteContentLoading, setRemoteContentLoading] = useState(false);
    const [remoteContentError, setRemoteContentError] = useState("");
    const touchStartRef = useRef({ x: 0, y: 0 });
    const [activeMessageId, setActiveMessageId] = useState<string | null>(null);
    const [readingMessageMenu, setReadingMessageMenu] = useState<{ messageId: string; x: number; y: number } | null>(null);
    const [editingDiscussMessage, setEditingDiscussMessage] = useState<ChatMessage | null>(null);
    const [editingDiscussContent, setEditingDiscussContent] = useState("");
    const [activeAnnotationId, setActiveAnnotationId] = useState<string | null>(null);
    const [annotationTranslationOverrides, setAnnotationTranslationOverrides] = useState<Record<string, boolean>>({});
    const longPressTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const readingMessagePressStartRef = useRef<{ x: number; y: number } | null>(null);
    const chatDragRef = useRef<{ pointerId: number; startX: number; startY: number; originX: number; originY: number } | null>(null);
    const chatMovedRef = useRef(false);
    const scrollRef = useRef<HTMLDivElement>(null);
    const txtMeasureLineRef = useRef<HTMLParagraphElement>(null);
    const txtMeasureGapRef = useRef<HTMLDivElement>(null);
    const txtMeasureAnnotationRef = useRef<HTMLDivElement>(null);
    const generatedBatchesRef = useRef<Set<string>>(new Set());
    const autoBootstrapInFlightRef = useRef(false);
    const pendingTxtPageFractionRef = useRef<number | null>(null);
    const initialTxtScrollFractionRef = useRef<number | null>(null);
    const lastTxtPaginationSignatureRef = useRef("");
    const [txtLayoutVersion, setTxtLayoutVersion] = useState(0);
    const [txtPages, setTxtPages] = useState<TxtPageItem[][]>([]);
    const [flipAnim, setFlipAnim] = useState<{ direction: 'forward' | 'backward'; items: TxtPageItem[] } | null>(null);

    const [enrichedContacts, setEnrichedContacts] = useState<(ReturnType<typeof loadChatContacts>[number] & { char: Character })[]>([]);

    useEffect(() => {
        const chars = loadCharacters();
        const contacts = loadChatContacts();
        const enriched = contacts
            .map(c => ({ ...c, char: chars.find(ch => ch.id === c.characterId) }))
            .filter(c => c.char) as (typeof contacts[number] & { char: Character })[];
        setEnrichedContacts(enriched);
    }, []);

    useEffect(() => {
        const nextSize = isPdf ? 5 : 50;
        setAnnotationBatchSize(nextSize);
        setAnnotationBatchInput(String(nextSize));
        setAutoAnnotate(false);
        generatedBatchesRef.current.clear();
    }, [book.id, isPdf]);

    useEffect(() => {
        setAnnotationTranslationOverrides({});
    }, [book.id, chapterIndex, readingConfig.collapseBilingualTranslation]);

    useEffect(() => {
        if (isPdf) return;
        try {
            const saved = window.localStorage.getItem(`reading-mode:${book.id}`);
            if (saved === "page" || saved === "continuous") setReadingMode(saved);
        } catch { /* ignore */ }
    }, [book.id, isPdf]);

    useEffect(() => {
        try {
            const shared = window.localStorage.getItem(`reading-shared-layout:${book.id}`) === "true";
            setSharedLayout(shared);
            const own = Number(window.localStorage.getItem(`reading-margin:${book.id}`));
            const ownMargin = Number.isFinite(own) && own >= 8 && own <= 48 ? own : 24;
            const common = Number(window.localStorage.getItem("reading-shared-margin"));
            const commonMargin = Number.isFinite(common) && common >= 8 && common <= 48 ? common : ownMargin;
            setReadingMargin(shared ? commonMargin : ownMargin);
            if (shared && !Number.isFinite(common)) window.localStorage.setItem("reading-shared-margin", String(ownMargin));
        } catch { setSharedLayout(false); setReadingMargin(24); }
    }, [book.id]);

    const companion = companionId ? (enrichedContacts.find(c => c.characterId === companionId)?.char || loadCharacters().find(c => c.id === companionId)) : null;
    const bilingualTranslationEnabled = readingConfig.bilingualTranslationEnabled === true;
    const defaultTranslationExpanded = readingConfig.collapseBilingualTranslation !== true;
    const currentChapter = chapters[chapterIndex];
    const txtPagesChapterIndex = txtPages[0]?.find((item) => item.kind !== "gap")?.chapterIndex ?? txtPages[0]?.[0]?.chapterIndex;
    const txtPagesReadyForCurrentChapter = !isPdf && txtPages.length > 0 && txtPagesChapterIndex === chapterIndex;
    const showTxtLoading = !isPdf && (
        !chaptersLoaded ||
        remoteContentLoading ||
        (chaptersLoaded && chapters.length > 0 && Boolean(currentChapter) && !txtPagesReadyForCurrentChapter)
    );

    const readingContentRef = useRef<HTMLDivElement>(null);

    const renderTxtPage = (pageIndex: number) => {
        const pageItems = txtPages[pageIndex] || [];
        if (pageItems.length === 0) return null;
        return (
            <div className="reading-page-content" ref={readingContentRef}>
                {pageItems.map((item, i) => (
                    item.kind === "gap"
                        ? <div key={i} className="reading-line-gap" data-paragraph-index={item.paragraphIndex} />
                        : item.kind === "annotation"
                            ? (
                                <div
                                    key={item.annotation.id}
                                    className="reading-annotation reading-annotation-interactive"
                                    data-no-nav="true"
                                    data-paragraph-index={item.paragraphIndex}
                                    onPointerDown={() => {
                                        longPressTimer.current = setTimeout(() => {
                                            setActiveMessageId(null);
                                            setActiveAnnotationId(item.annotation.id);
                                        }, 500);
                                    }}
                                    onPointerUp={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                                    onPointerCancel={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                                    onPointerLeave={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (activeAnnotationId && activeAnnotationId !== item.annotation.id) setActiveAnnotationId(null);
                                    }}
                                >
                                    <span className="reading-annotation-name">{item.annotation.characterName}</span>
                                    <ReadingAnnotationContent
                                        text={item.annotation.content}
                                        bilingualEnabled={bilingualTranslationEnabled}
                                        expanded={isAnnotationTranslationExpanded(item.annotation.id)}
                                        onToggle={() => handleAnnotationTranslationToggle(item.annotation.id)}
                                    />
                                    {activeAnnotationId === item.annotation.id && (
                                        <div className="ctx-menu reading-annotation-menu" onClick={(e) => e.stopPropagation()}>
                                            <button
                                                onClick={() => {
                                                    copyToClipboard(item.annotation.content);
                                                    setActiveAnnotationId(null);
                                                }}
                                                className="ctx-menu-btn"
                                            >
                                                复制
                                            </button>
                                            <button
                                                onClick={() => { void handleDeleteReadingAnnotation(item.annotation.id); }}
                                                className="ctx-menu-btn ctx-menu-btn-danger"
                                            >
                                                删除
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )
                            : item.text.startsWith("[[MANGA_IMAGE]]") ? <MangaImage key={i} url={item.text.slice("[[MANGA_IMAGE]]".length).trim()} /> : <p key={i} className={`reading-line${item.indent ? " reading-line-indent" : ""}${item.segEnd ? " reading-line-seg-end" : ""}`} data-paragraph-index={item.paragraphIndex}>{item.text}</p>
                ))}
            </div>
        );
    };

    const renderTxtChapter = (chapter: BookChapter, chapterIdx: number) => {
        const chapterAnnotations = annotations.filter((annotation) => annotation.chapterIndex === chapterIdx);
        const annotationMap = new Map<number, ReadingAnnotation[]>();
        for (const annotation of chapterAnnotations) {
            const list = annotationMap.get(annotation.paragraphIndex) || [];
            list.push(annotation);
            annotationMap.set(annotation.paragraphIndex, list);
        }

        return (
            <section className="reading-continuous-chapter" data-chapter-index={chapterIdx}>
                <div className="reading-continuous-chapter-title">{chapter.title || `第${chapterIdx + 1}章`}</div>
                <div className="reading-page-content">
                    {chapter.paragraphs.map((paragraph, paragraphIndex) => (
                        <div key={`${chapter.id}-${paragraphIndex}`}>
                            {paragraph.split("\n").map((segment, segmentIndex) => (
                                <p
                                    key={`${chapter.id}-${paragraphIndex}-${segmentIndex}`}
                                    className={`reading-line${segmentIndex === 0 ? " reading-line-indent" : ""}${segmentIndex === paragraph.split("\n").length - 1 ? " reading-line-seg-end" : ""}`}
                                    data-chapter-index={chapterIdx}
                                    data-paragraph-index={paragraphIndex}
                                >
                                    {segment.startsWith("[[MANGA_IMAGE]]") ? <MangaImage url={segment.slice("[[MANGA_IMAGE]]".length).trim()} /> : segment}
                                </p>
                            ))}
                            {(annotationMap.get(paragraphIndex) || []).map((annotation) => (
                                <div
                                    key={annotation.id}
                                    className="reading-annotation reading-annotation-interactive"
                                    data-no-nav="true"
                                    data-chapter-index={chapterIdx}
                                    data-paragraph-index={paragraphIndex}
                                    onPointerDown={() => {
                                        longPressTimer.current = setTimeout(() => {
                                            setActiveMessageId(null);
                                            setActiveAnnotationId(annotation.id);
                                        }, 500);
                                    }}
                                    onPointerUp={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                                    onPointerCancel={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                                    onPointerLeave={() => { if (longPressTimer.current) clearTimeout(longPressTimer.current); }}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (activeAnnotationId && activeAnnotationId !== annotation.id) setActiveAnnotationId(null);
                                    }}
                                >
                                    <span className="reading-annotation-name">{annotation.characterName}</span>
                                    <ReadingAnnotationContent
                                        text={annotation.content}
                                        bilingualEnabled={bilingualTranslationEnabled}
                                        expanded={isAnnotationTranslationExpanded(annotation.id)}
                                        onToggle={() => handleAnnotationTranslationToggle(annotation.id)}
                                    />
                                    {activeAnnotationId === annotation.id && (
                                        <div className="ctx-menu reading-annotation-menu" onClick={(e) => e.stopPropagation()}>
                                            <button onClick={() => { copyToClipboard(annotation.content); setActiveAnnotationId(null); }} className="ctx-menu-btn">复制</button>
                                            <button onClick={() => { void handleDeleteReadingAnnotation(annotation.id); }} className="ctx-menu-btn ctx-menu-btn-danger">删除</button>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    ))}
                </div>
            </section>
        );
    };

    const renderStaticPage = (items: TxtPageItem[]) => (
        <div className="reading-page-content">
            {items.map((item, i) =>
                item.kind === "gap"
                    ? <div key={i} className="reading-line-gap" data-paragraph-index={item.paragraphIndex} />
                    : item.kind === "annotation"
                        ? <div key={i} className="reading-annotation" data-paragraph-index={item.paragraphIndex}>
                            <span className="reading-annotation-name">{item.annotation.characterName}</span>
                            <span className="reading-annotation-text">{item.annotation.content}</span>
                        </div>
                        : item.text.startsWith("[[MANGA_IMAGE]]") ? <MangaImage key={i} url={item.text.slice("[[MANGA_IMAGE]]".length).trim()} /> : <p key={i} className={`reading-line${item.indent ? " reading-line-indent" : ""}${item.segEnd ? " reading-line-seg-end" : ""}`} data-paragraph-index={item.paragraphIndex}>{item.text}</p>
            )}
        </div>
    );

    const totalParagraphs = useMemo(
        () => chapters.reduce((sum, chapter) => sum + chapter.paragraphs.length, 0),
        [chapters],
    );
    const charPickerBottom = showChat ? (chatExpanded ? 284 : 76) : 64;
    const paragraphRefs = useMemo(() => buildParagraphRefsFromChapters(chapters), [chapters]);
    const pdfRenderAnnotations = useMemo(() => {
        if (!isPdf) return annotations;
        const absoluteIndexMap = new Map(
            paragraphRefs.map((item) => [`${item.chapterIndex}:${item.paragraphIndex}`, item.absoluteIndex] as const),
        );
        return annotations
            .map((annotation) => {
                const absoluteIndex = absoluteIndexMap.get(`${annotation.chapterIndex}:${annotation.paragraphIndex}`);
                if (absoluteIndex === undefined) return null;
                return {
                    ...annotation,
                    paragraphIndex: absoluteIndex,
                };
            })
            .filter((annotation): annotation is ReadingAnnotation => annotation !== null);
    }, [annotations, isPdf, paragraphRefs]);

    const pdfAnnotationChapter: BookChapter | undefined = useMemo(() => {
        if (!isPdf || chapters.length === 0) return undefined;
        return {
            id: `${book.id}_pdf_all`,
            bookId: book.id,
            index: 0,
            title: book.title,
            paragraphs: paragraphRefs.map((item) => item.text),
            paragraphPages: paragraphRefs.map((item) => item.pageNum ?? 1),
            paragraphYPositions: paragraphRefs.map((item) => item.yRatio ?? 0.5),
        };
    }, [book.id, book.title, chapters.length, isPdf, paragraphRefs]);

    const clampBatchSize = useCallback((value: number) => {
        const fallback = isPdf ? 5 : 50;
        if (!Number.isFinite(value)) return fallback;
        const min = 1;
        const max = isPdf ? 30 : 200;
        return Math.min(max, Math.max(min, Math.round(value)));
    }, [isPdf]);

    const isAnnotationTranslationExpanded = useCallback((annotationId: string) => {
        return annotationTranslationOverrides[annotationId] ?? defaultTranslationExpanded;
    }, [annotationTranslationOverrides, defaultTranslationExpanded]);

    const handleAnnotationTranslationToggle = useCallback((annotationId: string) => {
        setAnnotationTranslationOverrides((prev) => {
            const current = prev[annotationId] ?? defaultTranslationExpanded;
            return { ...prev, [annotationId]: !current };
        });
        if (!isPdf) {
            setTxtLayoutVersion((version) => version + 1);
        }
    }, [defaultTranslationExpanded, isPdf]);

    // Find or create chat session for companion — 确保阅读APP和聊天APP共享同一会话
    const getSession = useCallback((): ChatSession | null => {
        if (!companionId) return null;
        const sessions = loadChatSessions();
        const existing = sessions.find(s => !s.isGroup && s.contactId === companionId);
        if (existing) return existing;
        // 会话不存在时自动创建，确保聊天APP能同步看到消息
        const contacts = loadChatContacts();
        const contact = contacts.find(c => c.characterId === companionId);
        const newSession: ChatSession = {
            id: `s_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            contactId: companionId,
            isGroup: false,
            createdAt: Date.now(),
            lastMessageAt: Date.now(),
            unreadCount: 0,
            title: contact?.name || "阅读讨论",
        };
        saveChatSessions([...sessions, newSession]);
        return newSession;
    }, [companionId]);


    // Load book data
    useEffect(() => {
        setChaptersLoaded(false);
        (async () => {
            let chs = await loadChapters(book.id);
            if (!isPdf && chs.length === 0) {
                const rawFile = await loadRawFileBlob(book.id);
                if (rawFile && rawFile.size > 0) {
                    try {
                        const parsed = book.format === "txt"
                            ? parseTxtContent(decodeTxtArrayBuffer(await rawFile.arrayBuffer()).text, book.title)
                            : await parseEpubFile(await rawFile.arrayBuffer(), book.title);
                        const rebuiltChapters: BookChapter[] = parsed.chapters.map((chapter, index) => ({
                            id: `${book.id}_ch${index}`,
                            bookId: book.id,
                            index,
                            title: chapter.title,
                            paragraphs: chapter.paragraphs,
                        }));
                        if (rebuiltChapters.length > 0) {
                            await saveChapters(book.id, rebuiltChapters);
                            await updateBook({
                                ...book,
                                title: parsed.title || book.title,
                                author: parsed.author,
                                totalChapters: rebuiltChapters.length,
                            });
                            chs = rebuiltChapters;
                        }
                    } catch (err) {
                        console.error("[Reading] Failed to rebuild text chapters from raw file:", err);
                    }
                }
            }
            setChapters(chs);
            const progress = await loadProgress(book.id);
            if (progress) {
                const safeChapterIndex = chs.length > 0
                    ? Math.max(0, Math.min(chs.length - 1, progress.chapterIndex))
                    : 0;
                setChapterIndex(safeChapterIndex);
                setCompanionId(progress.companionCharacterId || null);
                if (!isPdf) {
                    setTxtPage(Math.max(0, progress.scrollPosition || 0));
                    initialTxtScrollFractionRef.current = progress.scrollPosition > 1000
                        ? Math.max(0, Math.min(1, progress.scrollPosition / 100000))
                        : (progress.progressCurrent && progress.progressTotal
                            ? Math.max(0, Math.min(1, (progress.progressCurrent - 1) / Math.max(1, progress.progressTotal - 1)))
                            : 0);
                }
            }
            // Default companion: first contact
            if (!progress?.companionCharacterId && enrichedContacts.length > 0) {
                setCompanionId(enrichedContacts[0].characterId);
            }
            if (!progress && !isPdf) setTxtPage(0);
            setChaptersLoaded(true);
        })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [book.id]);

    // 在线书籍的目录只保存章节地址，正文按当前章节懒加载；本地 TXT/EPUB 不会进入这里。
    useEffect(() => {
        const targetChapter = chapters[chapterIndex];
        if (isPdf || !chaptersLoaded || !targetChapter || targetChapter.paragraphs.length > 0) return;
        const shushanRemote = getRemoteBook(book.id);
        const genericRemote = getReadingRemoteBook(book.id);
        if (!shushanRemote && !genericRemote) return;
        let cancelled = false;
        setRemoteContentLoading(true);
        setRemoteContentError("");
        (async () => {
            try {
                let content = "";
                if (shushanRemote) {
                    const chapter = shushanRemote.chapters?.[chapterIndex];
                    if (!chapter) throw new Error("在线章节信息不存在");
                    const apiKey = shushanRemote.apiKey || loadShushanAccount().apiKey;
                    if (!apiKey) throw new Error("书山登录状态已失效，请重新登录");
                    const result = await getShushanChapterContent(
                        apiKey,
                        chapter,
                        { source: shushanRemote.source, url: shushanRemote.url, name: shushanRemote.name },
                        createDeviceId(),
                    );
                    content = result.content || "";
                } else if (genericRemote) {
                    const source = getReadingSource(genericRemote.sourceId);
                    const chapter = genericRemote.chapters?.[chapterIndex];
                    if (!source || !chapter) throw new Error("在线书源或章节信息不存在");
                    content = await getGenericChapterContent(source, chapter);
                }
                const paragraphs = htmlToParagraphs(content);
                if (!paragraphs.length) throw new Error("正文接口返回为空");
                if (cancelled) return;
                const nextChapters = chapters.map((chapter, index) =>
                    index === chapterIndex ? { ...chapter, paragraphs } : chapter,
                );
                await saveChapters(book.id, nextChapters);
                if (cancelled) return;
                setChapters(nextChapters);
                setTxtPage(0);
                setRemoteContentError("");
            } catch (error) {
                if (!cancelled) setRemoteContentError(error instanceof Error ? error.message : "在线正文加载失败");
            } finally {
                if (!cancelled) setRemoteContentLoading(false);
            }
        })();
        return () => { cancelled = true; };
    }, [book.id, chapterIndex, chapters, chaptersLoaded, isPdf]);

    useEffect(() => {
        if (chapters.length === 0) return;
        if (chapterIndex >= 0 && chapterIndex < chapters.length) return;
        setChapterIndex(Math.max(0, Math.min(chapters.length - 1, chapterIndex)));
    }, [chapterIndex, chapters.length]);

    useEffect(() => {
        if (!isPdf || pdfTotalPages <= 0 || chapters.length === 0) return;
        const expectedCount = Math.max(1, Math.ceil(pdfTotalPages / PDF_PAGES_PER_CHAPTER));
        const needsSkeletonRefresh =
            chapters.length !== expectedCount ||
            chapters.some((chapter, index) => {
                const startPage = index * PDF_PAGES_PER_CHAPTER + 1;
                const endPage = Math.min(startPage + PDF_PAGES_PER_CHAPTER - 1, pdfTotalPages);
                return chapter.pageStart !== startPage || chapter.pageEnd !== endPage;
            });
        if (!needsSkeletonRefresh) return;

        const nextChapters: BookChapter[] = Array.from({ length: expectedCount }, (_, index) => {
            const startPage = index * PDF_PAGES_PER_CHAPTER + 1;
            const endPage = Math.min(startPage + PDF_PAGES_PER_CHAPTER - 1, pdfTotalPages);
            const existing = chapters.find((chapter) => chapter.index === index);
            return {
                id: existing?.id || `${book.id}_ch${index}`,
                bookId: book.id,
                index,
                title: buildPdfChunkTitle(startPage, endPage),
                paragraphs: existing?.paragraphs || [],
                paragraphPages: existing?.paragraphPages,
                paragraphYPositions: existing?.paragraphYPositions,
                pageStart: startPage,
                pageEnd: endPage,
            };
        });

        void saveChapters(book.id, nextChapters).then(() => {
            setChapters(nextChapters);
        }).catch((err) => {
            console.error("[Reading] PDF chapter skeleton error:", err);
        });
    }, [book.id, chapters, isPdf, pdfTotalPages]);

    // Load annotations for current scope
    useEffect(() => {
        (async () => {
            if (isPdf) {
                const groups = await Promise.all(chapters.map((chapter) => loadAnnotations(book.id, chapter.index)));
                setAnnotations(groups.flat());
                return;
            }
            const annots = await loadAnnotations(book.id, chapterIndex);
            setAnnotations(annots);
        })();
    }, [book.id, chapterIndex, chapters, isPdf]);

    // Load all chat messages from the session (real-time sync with chat app)
    const refreshChatMessages = useCallback(() => {
        const session = getSession();
        if (!session) { setChatMessages([]); return; }
        // 加载当前会话消息
        let msgs = loadChatMessages(session.id);
        // 同时合并来自其他同 contactId 会话的消息（确保聊天APP的消息也能显示）
        if (session.contactId && !session.isGroup) {
            try {
                const sessions = loadChatSessions();
                const otherSessions = sessions.filter(s =>
                    s.id !== session.id &&
                    !s.isGroup &&
                    s.contactId === session.contactId
                );
                for (const otherSession of otherSessions) {
                    const otherMsgs = loadChatMessages(otherSession.id);
                    msgs = [...msgs, ...otherMsgs];
                }
                // 去重并按时间排序
                if (otherSessions.length > 0) {
                    const seen = new Set<string>();
                    msgs = msgs.filter(m => {
                        if (seen.has(m.id)) return false;
                        seen.add(m.id);
                        return true;
                    });
                    msgs.sort((a, b) => {
                        const ta = a.createdAt || 0;
                        const tb = b.createdAt || 0;
                        if (ta !== tb) return ta - tb;
                        return a.id.localeCompare(b.id);
                    });
                }
            } catch {
                // 静默处理
            }
        }
        // 取最后50条，并对内容进行系统内容过滤
        msgs = msgs.slice(-50);
        setChatMessages(msgs);
    }, [getSession]);

    useEffect(() => { refreshChatMessages(); }, [refreshChatMessages, companionId]);

    // Reopen/expand the reading discussion at the latest message instead of the top.
    useLayoutEffect(() => {
        if (!showChat || !chatExpanded || !scrollRef.current) return;
        const body = document.querySelector(".reading-chat-float-body") as HTMLElement | null;
        if (!body) return;
        const scrollToLatest = () => { body.scrollTop = body.scrollHeight; };
        requestAnimationFrame(() => {
            scrollToLatest();
            requestAnimationFrame(scrollToLatest);
        });
    }, [showChat, chatExpanded, chatMessages.length, companionId]);

    // iOS Safari: focusing the reading discussion input can pan the entire fixed phone surface upward.
    // Lock the document only while this reading input owns focus, so the reading page and floating window stay put.
    useEffect(() => {
        if (typeof window === "undefined" || typeof document === "undefined") return;
        if (!/iPhone|iPad|iPod/i.test(navigator.userAgent)) return;

        const mobileMq = window.matchMedia("(max-width: 500px) and (hover: none) and (pointer: coarse)");
        if (!mobileMq.matches) return;

        const body = document.body;
        const original = {
            position: body.style.position,
            top: body.style.top,
            left: body.style.left,
            right: body.style.right,
            width: body.style.width,
        };
        let locked = false;
        let restoreScrollY = 0;
        let raf = 0;

        const isOurInput = (target: EventTarget | null) =>
            target instanceof HTMLInputElement && !!target.closest(".reading-chat-float-input");

        const forceScroll = () => {
            if (!locked) return;
            if (window.scrollY !== restoreScrollY) window.scrollTo(0, restoreScrollY);
        };

        const scheduleForceScroll = () => {
            if (raf) cancelAnimationFrame(raf);
            raf = requestAnimationFrame(forceScroll);
        };

        const lock = () => {
            if (locked) return;
            locked = true;
            restoreScrollY = window.scrollY || window.pageYOffset || 0;
            body.style.position = "fixed";
            body.style.top = `${-restoreScrollY}px`;
            body.style.left = "0";
            body.style.right = "0";
            body.style.width = "100%";
            scheduleForceScroll();
        };

        const unlock = () => {
            if (!locked) return;
            locked = false;
            if (raf) cancelAnimationFrame(raf);
            body.style.position = original.position;
            body.style.top = original.top;
            body.style.left = original.left;
            body.style.right = original.right;
            body.style.width = original.width;
            window.scrollTo(0, restoreScrollY);
        };

        const onFocusIn = (event: FocusEvent) => {
            if (isOurInput(event.target)) {
                lock();
                requestAnimationFrame(() => requestAnimationFrame(forceScroll));
            }
        };

        const onFocusOut = () => {
            window.setTimeout(() => {
                if (!isOurInput(document.activeElement)) unlock();
            }, 0);
        };

        document.addEventListener("focusin", onFocusIn, true);
        document.addEventListener("focusout", onFocusOut, true);
        window.addEventListener("scroll", scheduleForceScroll, { passive: true });
        window.visualViewport?.addEventListener("resize", scheduleForceScroll);
        window.visualViewport?.addEventListener("scroll", scheduleForceScroll);

        return () => {
            document.removeEventListener("focusin", onFocusIn, true);
            document.removeEventListener("focusout", onFocusOut, true);
            window.removeEventListener("scroll", scheduleForceScroll);
            window.visualViewport?.removeEventListener("resize", scheduleForceScroll);
            window.visualViewport?.removeEventListener("scroll", scheduleForceScroll);
            if (raf) cancelAnimationFrame(raf);
            unlock();
        };
    }, []);

    // Real-time sync: listen for chat message events from the chat app
    useEffect(() => {
        const handler = () => { refreshChatMessages(); };
        window.addEventListener(CHAT_MESSAGE_PUSHED_EVENT, handler);
        window.addEventListener(CHAT_MESSAGES_DELETED_EVENT, handler);
        return () => {
            window.removeEventListener(CHAT_MESSAGE_PUSHED_EVENT, handler);
            window.removeEventListener(CHAT_MESSAGES_DELETED_EVENT, handler);
        };
    }, [refreshChatMessages]);

    const [annotationError, setAnnotationError] = useState<string | null>(null);
    const loadExistingAnnotationsForItems = useCallback(async (items: ParagraphRef[]) => {
        const chapterIndexes = [...new Set(items.map((item) => item.chapterIndex))];
        const itemKeys = new Set(items.map((item) => `${item.chapterIndex}:${item.paragraphIndex}`));
        const groups = await Promise.all(chapterIndexes.map((idx) => loadAnnotations(book.id, idx)));
        return groups
            .flat()
            .filter((annotation) => itemKeys.has(`${annotation.chapterIndex}:${annotation.paragraphIndex}`));
    }, [book.id]);

    const ensurePdfPageRangeParsed = useCallback(async (startPage: number, endPage: number): Promise<BookChapter[]> => {
        if (!isPdf || chapters.length === 0) return chapters;

        const targetStart = Math.max(1, startPage);
        const targetEnd = Math.max(targetStart, endPage);
        const missing = chapters.filter((chapter) => {
            const chapterStart = chapter.pageStart ?? (chapter.index * PDF_PAGES_PER_CHAPTER + 1);
            const chapterEnd = chapter.pageEnd ?? (chapterStart + PDF_PAGES_PER_CHAPTER - 1);
            return chapter.paragraphs.length === 0 && chapterEnd >= targetStart && chapterStart <= targetEnd;
        });
        if (missing.length === 0) return chapters;

        const rawData = await loadRawFileBlob(book.id);
        if (!rawData || rawData.size === 0) {
            throw new Error("PDF 文件未找到或为空");
        }

        const parseStart = Math.min(...missing.map((chapter) => chapter.pageStart ?? (chapter.index * PDF_PAGES_PER_CHAPTER + 1)));
        const parseEnd = Math.max(...missing.map((chapter) => chapter.pageEnd ?? ((chapter.index + 1) * PDF_PAGES_PER_CHAPTER)));
        const parsed = await parsePdfPageRange(rawData, {
            startPage: parseStart,
            endPage: parseEnd,
            fileName: book.title,
        });

        const updates: BookChapter[] = parsed.chunks.map((chunk) => {
            const chunkIndex = Math.floor((chunk.startPage - 1) / PDF_PAGES_PER_CHAPTER);
            const existing = chapters[chunkIndex];
            return {
                id: existing?.id || `${book.id}_ch${chunkIndex}`,
                bookId: book.id,
                index: chunkIndex,
                title: chunk.title,
                paragraphs: chunk.paragraphs,
                paragraphPages: chunk.pdfMeta.map((item) => item.pageNum),
                paragraphYPositions: chunk.pdfMeta.map((item) => item.yRatio),
                pageStart: chunk.startPage,
                pageEnd: chunk.endPage,
            };
        });

        await saveChapters(book.id, updates);
        const merged = chapters.map((chapter) => {
            const replacement = updates.find((item) => item.index === chapter.index);
            return replacement || chapter;
        });
        setChapters(merged);
        return merged;
    }, [book.id, chapters, isPdf]);

    const buildTxtBatchRequest = useCallback((size: number, mode: AnnotationBatchMode): AnnotationBatchRequest | null => {
        const pageItems = txtPages[txtPage] || [];
        const visibleParagraphIndexes = [...new Set(
            pageItems
                .filter((item): item is Extract<TxtPageItem, { kind: "line" | "annotation" }> => item.kind === "line" || item.kind === "annotation")
                .map((item) => item.paragraphIndex),
        )].sort((a, b) => a - b);
        if (visibleParagraphIndexes.length === 0) return null;

        const minParagraphIndex = visibleParagraphIndexes[0];
        const maxParagraphIndex = visibleParagraphIndexes[visibleParagraphIndexes.length - 1];
        const visibleRefs = paragraphRefs.filter((item) => item.chapterIndex === chapterIndex && item.paragraphIndex >= minParagraphIndex && item.paragraphIndex <= maxParagraphIndex);
        if (visibleRefs.length === 0) return null;

        const startCandidates: number[] = [];
        if (mode === "manual") {
            startCandidates.push(visibleRefs[0].absoluteIndex);
        } else if (mode === "auto-current") {
            startCandidates.push(Math.floor(visibleRefs[0].absoluteIndex / size) * size);
        } else {
            for (let start = Math.floor(visibleRefs[0].absoluteIndex / size) * size; start <= visibleRefs[visibleRefs.length - 1].absoluteIndex; start += size) {
                if (start >= visibleRefs[0].absoluteIndex && start <= visibleRefs[visibleRefs.length - 1].absoluteIndex) {
                    startCandidates.push(start);
                    break;
                }
            }
        }

        const startAbsoluteIndex = startCandidates[0];
        if (startAbsoluteIndex === undefined) return null;
        const items = paragraphRefs.slice(startAbsoluteIndex, startAbsoluteIndex + size).filter((item) => item.text.trim());
        if (items.length === 0) return null;

        return {
            key: `txt:${startAbsoluteIndex}:${size}`,
            title: `第${items[0].absoluteIndex + 1}-${items[items.length - 1].absoluteIndex + 1}段`,
            size,
            items,
        };
    }, [chapterIndex, paragraphRefs, txtPage, txtPages]);

    const getPdfBatchWindow = useCallback((size: number, mode: AnnotationBatchMode) => {
        const chapterMaxPage = Math.max(0, ...chapters.map((chapter) => chapter.pageEnd ?? 0));
        const refMaxPage = Math.max(0, ...paragraphRefs.map((item) => item.pageNum || 0));
        const maxPage = pdfTotalPages || chapterMaxPage || refMaxPage;
        if (maxPage <= 0) return null;
        const startPage = mode === "manual" ? pdfCurrentPage : Math.floor((pdfCurrentPage - 1) / size) * size + 1;
        if (mode === "auto" && pdfCurrentPage !== startPage) return null;
        const endPage = Math.min(maxPage, startPage + size - 1);
        return {
            key: `pdf:${startPage}:${size}`,
            title: `第${startPage}-${endPage}页`,
            size,
            startPage,
            endPage,
        };
    }, [chapters, paragraphRefs, pdfCurrentPage, pdfTotalPages]);

    const buildPdfBatchRequest = useCallback((size: number, mode: AnnotationBatchMode, refs: ParagraphRef[] = paragraphRefs): AnnotationBatchRequest | null => {
        const windowInfo = getPdfBatchWindow(size, mode);
        if (!windowInfo) return null;
        const items = refs.filter((item) => (item.pageNum || 0) >= windowInfo.startPage && (item.pageNum || 0) <= windowInfo.endPage && item.text.trim());
        if (items.length === 0) return null;

        return {
            key: windowInfo.key,
            title: windowInfo.title,
            size: windowInfo.size,
            items,
        };
    }, [getPdfBatchWindow, paragraphRefs]);

    const materializeBatchRequest = useCallback(async (size: number, mode: AnnotationBatchMode): Promise<AnnotationBatchRequest | null> => {
        if (!isPdf) return buildTxtBatchRequest(size, mode);

        const windowInfo = getPdfBatchWindow(size, mode);
        if (!windowInfo) return null;

        const mergedChapters = await ensurePdfPageRangeParsed(windowInfo.startPage, windowInfo.endPage);
        const refs = buildParagraphRefsFromChapters(mergedChapters);
        return buildPdfBatchRequest(size, mode, refs);
    }, [buildPdfBatchRequest, buildTxtBatchRequest, ensurePdfPageRangeParsed, getPdfBatchWindow, isPdf]);

    const executeBatchAnnotation = useCallback(async (request: AnnotationBatchRequest, options?: { force?: boolean }) => {
        if (!companionId || generating) return;
        const batchKey = `${book.id}:${companionId}:${request.key}`;
        if (!options?.force && generatedBatchesRef.current.has(batchKey)) return;

        setGenerating(true);
        setAnnotationError(null);

        try {
            const existing = await loadExistingAnnotationsForItems(request.items);
            if (!options?.force && existing.length > 0) {
                generatedBatchesRef.current.add(batchKey);
                return;
            }

            const newAnnotations = await generateAnnotationBatch(
                book,
                request.title,
                request.items.map((item) => ({
                    chapterIndex: item.chapterIndex,
                    paragraphIndex: item.paragraphIndex,
                    text: item.text,
                })),
                existing,
                companionId,
            );

            generatedBatchesRef.current.add(batchKey);

            if (newAnnotations.length > 0) {
                await saveAnnotations(newAnnotations);
                setAnnotations((prev) => {
                    const merged = new Map(prev.map((annotation) => [annotation.id, annotation]));
                    for (const annotation of newAnnotations) merged.set(annotation.id, annotation);
                    return [...merged.values()];
                });
            } else {
                setAnnotationError("AI 没有返回批注（可能返回了[无批注]或API调用失败）");
            }
        } catch (err) {
            console.error("[Reading] Annotation error:", err);
            setAnnotationError(`批注失败: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            setGenerating(false);
        }
    }, [book, companionId, generating, loadExistingAnnotationsForItems]);

    const openAnnotationDialog = (mode: AnnotationDialogMode) => {
        const nextSize = annotationBatchSize || (isPdf ? 5 : 50);
        setAnnotationBatchInput(String(nextSize));
        setAnnotationDialogMode(mode);
    };

    const handleAnnotationDialogConfirm = async () => {
        if (!annotationDialogMode) return;
        const size = clampBatchSize(Number(annotationBatchInput));
        setAnnotationBatchSize(size);
        setAnnotationBatchInput(String(size));

        if (annotationDialogMode === "auto") {
            setAnnotationDialogMode(null);
            if (autoAnnotate) {
                setAutoAnnotate(false);
                return;
            }
            setAutoAnnotate(true);
            generatedBatchesRef.current.clear();
            autoBootstrapInFlightRef.current = true;
            try {
                const request = await materializeBatchRequest(size, "auto-current");
                if (request) await executeBatchAnnotation(request);
            } finally {
                autoBootstrapInFlightRef.current = false;
            }
            return;
        }

        const request = await materializeBatchRequest(size, "manual");
        setAnnotationDialogMode(null);
        if (!request) return;
        generatedBatchesRef.current.delete(`${book.id}:${companionId || ""}:${request.key}`);
        await executeBatchAnnotation(request, { force: true });
    };

    const openNavigationDialog = () => {
        setShowNavigationDialog(true);
    };

    const copyToClipboard = useCallback((text: string) => {
        const fallbackCopy = () => {
            const ta = document.createElement("textarea");
            ta.value = text;
            ta.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0";
            document.body.appendChild(ta);
            ta.focus();
            ta.select();
            try { document.execCommand("copy"); } catch {}
            document.body.removeChild(ta);
        };
        if (navigator.clipboard?.writeText) {
            navigator.clipboard.writeText(text).catch(fallbackCopy);
        } else {
            fallbackCopy();
        }
    }, []);

    const closeReadingMessageMenu = useCallback(() => {
        setReadingMessageMenu(null);
        setActiveMessageId(null);
    }, []);

    const cancelReadingMessageLongPress = useCallback(() => {
        readingMessagePressStartRef.current = null;
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
            longPressTimer.current = undefined;
        }
    }, []);

    const handleReadingMessagePointerDown = useCallback((event: React.PointerEvent<HTMLElement>, msg: ChatMessage) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        readingMessagePressStartRef.current = { x: event.clientX, y: event.clientY };
        if (longPressTimer.current) clearTimeout(longPressTimer.current);
        longPressTimer.current = setTimeout(() => {
            setActiveAnnotationId(null);
            setActiveMessageId(msg.id);
            setReadingMessageMenu({ messageId: msg.id, x: event.clientX, y: event.clientY });
            longPressTimer.current = undefined;
        }, 500);
    }, []);

    const handleReadingMessagePointerMove = useCallback((event: React.PointerEvent<HTMLElement>) => {
        const start = readingMessagePressStartRef.current;
        if (!start) return;
        const dx = Math.abs(event.clientX - start.x);
        const dy = Math.abs(event.clientY - start.y);
        if (dx > 10 || dy > 10) cancelReadingMessageLongPress();
    }, [cancelReadingMessageLongPress]);

    const getReadingMessageMenuStyle = useCallback((menu: { x: number; y: number }): React.CSSProperties => {
        const margin = 12;
        const estimatedWidth = 168;
        const estimatedHeight = 42;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const left = Math.min(
            Math.max(menu.x - estimatedWidth / 2, margin),
            Math.max(margin, viewportWidth - estimatedWidth - margin),
        );
        const top = menu.y > viewportHeight - estimatedHeight - 24
            ? Math.max(margin, menu.y - estimatedHeight - 12)
            : Math.min(menu.y + 12, viewportHeight - estimatedHeight - margin);

        return {
            left,
            top,
        };
    }, []);

    const handleEditDiscussMessageStart = useCallback((msg: ChatMessage) => {
        setEditingDiscussMessage(msg);
        setEditingDiscussContent(msg.content);
        closeReadingMessageMenu();
    }, [closeReadingMessageMenu]);

    const handleSaveDiscussMessageEdit = useCallback(() => {
        if (!editingDiscussMessage) return;
        const nextContent = editingDiscussContent.trim();
        if (!nextContent) return;
        editChatMessage(editingDiscussMessage.id, nextContent);
        setChatMessages((prev) => prev.map((msg) => msg.id === editingDiscussMessage.id ? { ...msg, content: nextContent } : msg));
        setEditingDiscussMessage(null);
        setEditingDiscussContent("");
    }, [editingDiscussContent, editingDiscussMessage]);

    useEffect(() => {
        if (!showChat || !chatExpanded) {
            setReadingMessageMenu(null);
            setActiveMessageId(null);
        }
    }, [showChat, chatExpanded]);

    const handleDeleteReadingAnnotation = useCallback(async (annotationId: string) => {
        await deleteAnnotation(annotationId);
        setAnnotations((prev) => prev.filter((annotation) => annotation.id !== annotationId));
        setActiveAnnotationId(null);
    }, []);

    const handleNavChapterClick = (index: number) => {
        if (isPdf) {
            const chapter = chapters[index];
            const firstPage = chapter?.pageStart ?? chapter?.paragraphPages?.[0] ?? 1;
            setChapterIndex(index);
            setPdfJumpPage(firstPage);
        } else {
            goToChapter(index);
        }
        setShowNavigationDialog(false);
    };

    const handleNavPageSlider = (value: number) => {
        if (isPdf) {
            setPdfJumpPage(value);
        } else {
            if (chapters.length === 0) return;
            const targetChapterIndex = Math.max(0, Math.min(chapters.length - 1, Math.round(value) - 1));
            if (targetChapterIndex !== chapterIndex) goToChapter(targetChapterIndex);
        }
    };

    const handleReadingSurfaceClick = (e: React.MouseEvent<HTMLDivElement>) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        if (target.closest("button, input, select, textarea, a, [data-no-nav='true']")) return;
        if (activeMessageId || activeAnnotationId) {
            setActiveMessageId(null);
            setActiveAnnotationId(null);
            return;
        }

        if (!isPdf && currentChapter && readingMode === "page") {
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            const x = e.clientX - rect.left;
            const w = rect.width;
            if (x < w * 0.3) { navigateWithFlip('backward'); return; }
            if (x > w * 0.7) { navigateWithFlip('forward'); return; }
        }

        setImmersive(prev => !prev);
    };

    useEffect(() => {
        if (!autoAnnotate || generating || !companionId || autoBootstrapInFlightRef.current) return;
        void (async () => {
            const request = await materializeBatchRequest(annotationBatchSize, "auto");
            if (!request) return;
            await executeBatchAnnotation(request);
        })();
    }, [annotationBatchSize, autoAnnotate, companionId, executeBatchAnnotation, generating, materializeBatchRequest]);

    useEffect(() => {
        if (!isPdf || pdfCurrentPage <= 0 || chapters.length === 0) return;
        const chunkStart = Math.floor((pdfCurrentPage - 1) / PDF_PAGES_PER_CHAPTER) * PDF_PAGES_PER_CHAPTER + 1;
        const chunkEnd = Math.min(chunkStart + PDF_PAGES_PER_CHAPTER - 1, pdfTotalPages || chunkStart + PDF_PAGES_PER_CHAPTER - 1);
        void ensurePdfPageRangeParsed(chunkStart, chunkEnd).catch((err) => {
            console.error("[Reading] PDF lazy parse error:", err);
        });
    }, [chapters.length, ensurePdfPageRangeParsed, isPdf, pdfCurrentPage, pdfTotalPages]);

    // Chapter navigation
    const goToChapter = (idx: number, startFromEnd = false) => {
        if (idx < 0 || idx >= chapters.length) return;
        pendingTxtPageFractionRef.current = startFromEnd ? 1 : null;
        if (!isPdf) initialTxtScrollFractionRef.current = startFromEnd ? 1 : 0;
        setChapterIndex(idx);
        setTxtPage(0);
        if (!isPdf) scrollRef.current?.scrollTo({ top: startFromEnd ? Number.MAX_SAFE_INTEGER : 0, behavior: "auto" });
        else scrollRef.current?.scrollTo(0, 0);
    };

    const buildDiscussContext = useCallback((sourceChapters: BookChapter[] = chapters): ReadingDiscussContext | null => {
        const sourceParagraphRefs = buildParagraphRefsFromChapters(sourceChapters);
        if (sourceParagraphRefs.length === 0) return null;

        let focusChapterIndex = chapterIndex;
        let focusParagraphIndexes: number[] = [];

        if (isPdf) {
            let focusRefs = sourceParagraphRefs.filter((item) => item.text.trim() && (item.pageNum || 0) === pdfCurrentPage);
            if (focusRefs.length === 0) {
                let nearestDistance = Number.POSITIVE_INFINITY;
                for (const item of sourceParagraphRefs) {
                    if (!item.text.trim() || !item.pageNum) continue;
                    nearestDistance = Math.min(nearestDistance, Math.abs(item.pageNum - pdfCurrentPage));
                }
                if (Number.isFinite(nearestDistance)) {
                    focusRefs = sourceParagraphRefs.filter((item) => item.text.trim() && item.pageNum && Math.abs(item.pageNum - pdfCurrentPage) === nearestDistance);
                }
            }
            if (focusRefs.length === 0) return null;

            const chapterCounts = new Map<number, number>();
            for (const item of focusRefs) {
                chapterCounts.set(item.chapterIndex, (chapterCounts.get(item.chapterIndex) || 0) + 1);
            }
            focusChapterIndex = [...chapterCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? chapterIndex;
            focusParagraphIndexes = [...new Set(
                focusRefs
                    .filter((item) => item.chapterIndex === focusChapterIndex)
                    .map((item) => item.paragraphIndex),
            )].sort((a, b) => a - b);
        } else {
            const visible = captureVisibleParagraphs();
            if (visible && visible.length > 0) {
                const chapterVisible = visible
                    .filter((item) => item.chapterIndex === chapterIndex)
                    .map((item) => item.paragraphIndex);
                focusParagraphIndexes = [...new Set(chapterVisible)].sort((a, b) => a - b);
            }
            if (focusParagraphIndexes.length === 0) {
                const pageItems = txtPages[txtPage] || [];
                focusParagraphIndexes = [...new Set(
                    pageItems
                        .filter((item): item is Extract<TxtPageItem, { kind: "line" | "annotation" }> => item.kind === "line" || item.kind === "annotation")
                        .map((item) => item.paragraphIndex),
                )].sort((a, b) => a - b);
            }
        }

        if (focusParagraphIndexes.length === 0) return null;

        // Get all paragraph refs in the current chapter
        const chapterRefs = sourceParagraphRefs.filter((item) => item.chapterIndex === focusChapterIndex && item.text.trim());
        if (chapterRefs.length === 0) return null;

        // Find the current page's position within the chapter
        const focusStartParagraph = focusParagraphIndexes[0];
        const focusEndParagraph = focusParagraphIndexes[focusParagraphIndexes.length - 1];
        let startPos = chapterRefs.findIndex((item) => item.paragraphIndex === focusStartParagraph);
        let endPos = chapterRefs.findIndex((item) => item.paragraphIndex === focusEndParagraph);
        if (startPos === -1 || endPos === -1) return null;

        // Expand context outward (both directions) until reaching target chars
        let usedChars = chapterRefs.slice(startPos, endPos + 1).reduce((sum, item) => sum + getParagraphLength(item.text), 0);
        while ((usedChars < DISCUSS_TARGET_CHARS || usedChars < DISCUSS_MIN_CHARS) && (startPos > 0 || endPos < chapterRefs.length - 1)) {
            if (endPos - startPos + 1 >= DISCUSS_MAX_PARAGRAPHS) break;

            const prevRef = startPos > 0 ? chapterRefs[startPos - 1] : null;
            const nextRef = endPos < chapterRefs.length - 1 ? chapterRefs[endPos + 1] : null;
            if (!prevRef && !nextRef) break;

            const prevChars = prevRef ? getParagraphLength(prevRef.text) : Number.POSITIVE_INFINITY;
            const nextChars = nextRef ? getParagraphLength(nextRef.text) : Number.POSITIVE_INFINITY;
            const pickPrev = prevRef && (!nextRef || prevChars <= nextChars);
            const candidate = pickPrev ? prevRef : nextRef;
            if (!candidate) break;

            const nextUsedChars = usedChars + getParagraphLength(candidate.text);
            if (usedChars >= DISCUSS_TARGET_CHARS && usedChars >= DISCUSS_MIN_CHARS && nextUsedChars > DISCUSS_MAX_CHARS) break;

            if (pickPrev) startPos -= 1;
            else endPos += 1;
            usedChars = nextUsedChars;
        }

        const contextRefs = chapterRefs.slice(startPos, endPos + 1);
        if (contextRefs.length === 0) return null;

        const contextStartParagraph = contextRefs[0].paragraphIndex;
        const contextEndParagraph = contextRefs[contextRefs.length - 1].paragraphIndex;
        const paragraphSet = new Set(contextRefs.map((item) => item.paragraphIndex));
        const contextAnnotations = annotations.filter(
            (annotation) => annotation.chapterIndex === focusChapterIndex && paragraphSet.has(annotation.paragraphIndex),
        );

        // Build chapter title
        const chapterTitleText = chapters[focusChapterIndex]?.title || currentChapter?.title || book.title;

        // Format content — contiguous block centered on current page
        const chapterContent = [
            `当前阅读中心：${formatParagraphRangeLabel(focusStartParagraph, focusEndParagraph)}`,
            `本次上下文范围：${formatParagraphRangeLabel(contextStartParagraph, contextEndParagraph)}`,
            "",
            contextRefs.map((item) => `[${item.paragraphIndex + 1}] ${item.text}`).join("\n\n"),
        ].join("\n");

        return {
            chapterTitle: chapterTitleText,
            chapterContent,
            annotations: contextAnnotations,
        };
    }, [annotations, book.title, chapterIndex, chapters, currentChapter?.title, isPdf, pdfCurrentPage, txtPage, txtPages]);

    // Chat send — parse AI response like chat-room does
    const handleSend = async () => {
        if (!chatInput.trim() || !companionId || chatting) return;
        const text = chatInput.trim();
        setChatInput("");

        const session = getSession();
        if (!session) return;

        // Save user message — pushChatMessage dispatches event, refreshChatMessages() will pick it up
        const userMsg = pushChatMessage({
            sessionId: session.id,
            role: "user",
            content: text,
            origin: "reading_discuss",
            mediaData: { readingBookTitle: book.title },
        });
        // 不直接 setChatMessages，依赖 refreshChatMessages 从 storage 加载，避免重复
        refreshChatMessages();

        setChatting(true);
        try {
            const sourceChapters = isPdf
                ? await ensurePdfPageRangeParsed(
                    Math.floor((pdfCurrentPage - 1) / PDF_PAGES_PER_CHAPTER) * PDF_PAGES_PER_CHAPTER + 1,
                    Math.min(
                        Math.floor((pdfCurrentPage - 1) / PDF_PAGES_PER_CHAPTER) * PDF_PAGES_PER_CHAPTER + PDF_PAGES_PER_CHAPTER,
                        pdfTotalPages || Math.floor((pdfCurrentPage - 1) / PDF_PAGES_PER_CHAPTER) * PDF_PAGES_PER_CHAPTER + PDF_PAGES_PER_CHAPTER,
                    ) - 1,
                )
                : chapters;
            const discussContext = buildDiscussContext(sourceChapters);
            if (!discussContext) return;
            const rawReply = await generateReadingChat(session, book, discussContext, companionId);
            if (rawReply) {
                const { reply, actions } = parseReadingDiscussResponse(rawReply);
                // 过滤系统级内容：移除 XML 标签、系统指令等不应展示给用户的内容
                const cleanReply = reply ? filterSystemContent(reply) : "";
                // Parse like chat: split into parts, extract inner monologue, state values, media
                if (cleanReply) {
                    const { parts, statusPanel, innerMonologue, stateValues, freshStateValues } = parseAIResponse(cleanReply, []);
                    const newMsgs: ChatMessage[] = [];
                    const saveParts: typeof parts = parts.length > 0 || !(statusPanel || innerMonologue) ? parts : [{ content: "" }];
                    for (let i = 0; i < saveParts.length; i++) {
                        // 对每个部分再次过滤系统内容，确保存储的消息是干净的
                        const partContent = saveParts[i].content ? filterSystemContent(saveParts[i].content) : saveParts[i].content;
                        // 跳过过滤后为空的部分（非媒体类型）
                        if (!partContent?.trim() && !saveParts[i].mediaType) continue;
                        const msg = pushChatMessage({
                            sessionId: session.id,
                            role: "assistant",
                            content: partContent,
                            mediaType: saveParts[i].mediaType,
                            origin: "reading_discuss",
                            mediaData: { ...saveParts[i].mediaData, readingBookTitle: book.title },
                            statusPanel: i === 0 && statusPanel ? statusPanel : undefined,
                            innerMonologue: i === 0 && innerMonologue ? filterSystemContent(innerMonologue) : undefined,
                            stateValues: i === 0 && stateValues.length > 0 ? stateValues : undefined,
                            freshStateValues: i === 0 ? freshStateValues : undefined,
                        });
                        newMsgs.push(msg);
                    }
                    // 不直接 setChatMessages，依赖 refreshChatMessages 从 storage 加载，避免重复
                    refreshChatMessages();
                }
                if (actions.length > 0) {
                    await applyDiscussActions(actions);
                }
            }
        } catch (err) {
            console.error("[Reading] Chat error:", err);
        } finally {
            setChatting(false);
        }
    };

    const applyDiscussActions = useCallback(async (actions: ReadingDiscussAction[]) => {
        if (!currentChapter || !companionId || !companion) return;

        let nextAnnotations = annotations;

        for (const action of actions) {
            if (action.type === "add_annotation") {
                if (action.paragraphIndex < 0 || action.paragraphIndex >= currentChapter.paragraphs.length) continue;
                const annotation: ReadingAnnotation = {
                    id: `ra_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    bookId: book.id,
                    chapterIndex,
                    paragraphIndex: action.paragraphIndex,
                    characterId: companionId,
                    characterName: companion.name,
                    content: action.content,
                    createdAt: new Date().toISOString(),
                };
                await saveAnnotation(annotation);
                nextAnnotations = [...nextAnnotations, annotation];
                continue;
            }

            const target = nextAnnotations.find((annotation) => annotation.id === action.annotationId && annotation.chapterIndex === chapterIndex);
            if (!target) continue;

            if (action.type === "delete_annotation") {
                await deleteAnnotation(action.annotationId);
                nextAnnotations = nextAnnotations.filter((annotation) => annotation.id !== action.annotationId);
                continue;
            }

            const updated: ReadingAnnotation = {
                ...target,
                content: action.content,
            };
            await saveAnnotation(updated);
            nextAnnotations = nextAnnotations.map((annotation) => annotation.id === updated.id ? updated : annotation);
        }

        setAnnotations(nextAnnotations);
    }, [annotations, book.id, chapterIndex, companion, companionId, currentChapter]);

    const handleOpenChat = () => {
        setShowChat(true);
        setChatExpanded(false);
        closeCharPicker();
    };

    const [chatClosing, setChatClosing] = useState(false);
    const handleCloseChat = () => {
        if (chatClosing) return;
        setChatClosing(true);
        setTimeout(() => {
            setShowChat(false);
            setChatExpanded(false);
            setChatClosing(false);
        }, 200);
    };

    const shouldIgnoreChatAction = () => {
        if (!chatMovedRef.current) return false;
        chatMovedRef.current = false;
        return true;
    };

    const handleChatDragStart = (e: React.PointerEvent<HTMLElement>) => {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        // Don't hijack the message list scroll or the input — only drag from the chrome.
        if ((e.target as HTMLElement).closest("button, input, textarea, select, a, .reading-chat-float-body, .reading-char-picker")) return;
        setIsDragging(true);
        chatDragRef.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            originX: chatOffset.x,
            originY: chatOffset.y,
        };
        chatMovedRef.current = false;
        e.currentTarget.setPointerCapture?.(e.pointerId);
    };

    const handleChatDragMove = (e: React.PointerEvent<HTMLElement>) => {
        const drag = chatDragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        const nextX = drag.originX + (e.clientX - drag.startX);
        const nextY = drag.originY + (e.clientY - drag.startY);
        const dragThreshold = e.pointerType === "touch" ? 12 : 6;
        if (!chatMovedRef.current && (Math.abs(nextX - drag.originX) > dragThreshold || Math.abs(nextY - drag.originY) > dragThreshold)) {
            chatMovedRef.current = true;
        }
        if (chatMovedRef.current) {
            setChatOffset({ x: nextX, y: nextY });
        }
    };

    const handleChatDragEnd = (e: React.PointerEvent<HTMLElement>) => {
        const drag = chatDragRef.current;
        if (!drag || drag.pointerId !== e.pointerId) return;
        chatDragRef.current = null;
        e.currentTarget.releasePointerCapture?.(e.pointerId);
        setIsDragging(false);

        // Snap to edges horizontally if not expanded, or bound within screen
        const marginX = 12; // left/right margin defined in CSS
        const marginY = 12; // bottom margin
        const w = window.innerWidth;
        const h = window.innerHeight;

        let targetX = chatOffset.x;
        let targetY = chatOffset.y;

        // Keep inside bounds roughly
        // If not expanded, we might want to snap to left or right edge.
        // For simplicity, just bound it inside the screen so it doesn't get lost
        const elWidth = chatExpanded ? 300 : Math.min(260, w - 64);
        const elHeight = chatExpanded ? 380 : 56;

        // Original CSS positions it at left: 12px, bottom: 12px
        // So default position is (0,0) offset from that.
        // Screen bounds for offset:
        const minX = -marginX; // touch left edge
        const maxX = w - elWidth - marginX; // touch right edge
        const maxY = h - elHeight - marginY - 60; // 60 for safe area approx
        const minY = -marginY - 120; // Some upper bound

        targetX = Math.max(minX, Math.min(targetX, maxX));
        // Only apply strict Y bounding if it goes way out of bounds
        // Since Y is from bottom, positive Y goes up, negative Y goes down
        // Wait, translate3d positive Y goes DOWN visually.
        // We'll just do a light bounding to ensure it doesn't disappear.
        if (targetX !== chatOffset.x || targetY !== chatOffset.y) {
            setChatOffset({ x: targetX, y: chatOffset.y });
        }
    };

    const handleChatLaunchClick = () => {
        if (chatMovedRef.current) {
            chatMovedRef.current = false;
            return;
        }
        handleOpenChat();
    };

    const chatFloatingStyle = {
        transform: `translate3d(${chatOffset.x}px, ${chatOffset.y}px, 0)`,
        transition: isDragging ? 'none' : 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275), width 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), height 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275), border-radius 0.3s ease-out',
    };

    useEffect(() => {
        if (isPdf || !scrollRef.current) return;

        const body = scrollRef.current;
        const onResize = () => setTxtLayoutVersion((v) => v + 1);
        const resizeObserver = new ResizeObserver(onResize);
        resizeObserver.observe(body);

        const fontsReady = (document as Document & { fonts?: FontFaceSet }).fonts?.ready;
        fontsReady?.then(onResize).catch(() => {});

        return () => resizeObserver.disconnect();
    }, [isPdf]);

    useEffect(() => {
        if (isPdf || !currentChapter) return;
        const rafId = window.requestAnimationFrame(() => {
            setTxtLayoutVersion((v) => v + 1);
        });
        return () => window.cancelAnimationFrame(rafId);
    }, [annotations, chapterIndex, currentChapter, isPdf]);

    // TXT pagination — split by actual rendered width/height so each page fits one screen.
    useEffect(() => {
        if (isPdf || !currentChapter || !scrollRef.current || !txtMeasureLineRef.current || !txtMeasureGapRef.current || !txtMeasureAnnotationRef.current) {
            setTxtPages([]);
            return;
        }

        const body = scrollRef.current;
        const bodyStyle = window.getComputedStyle(body);
        const bodyPaddingX = parseFloat(bodyStyle.paddingLeft || "0") + parseFloat(bodyStyle.paddingRight || "0");
        const bodyPaddingY = parseFloat(bodyStyle.paddingTop || "0") + parseFloat(bodyStyle.paddingBottom || "0");
        const surface = body.querySelector('.reading-page-surface') as HTMLElement | null;
        const surfacePadX = surface
            ? parseFloat(getComputedStyle(surface).paddingLeft || "0") + parseFloat(getComputedStyle(surface).paddingRight || "0")
            : 0;
        const maxWidth = Math.max(1, body.clientWidth - bodyPaddingX - surfacePadX);
        const bottomOverlayReserve = 40;
        const maxHeight = Math.max(1, body.clientHeight - bodyPaddingY - bottomOverlayReserve);

        const lineStyle = window.getComputedStyle(txtMeasureLineRef.current);
        const gapStyle = window.getComputedStyle(txtMeasureGapRef.current);
        const lineHeight = parseFloat(lineStyle.lineHeight || "0") || 30.4;
        const gapHeight = parseFloat(gapStyle.height || "0") || 20;
        const fontSize = parseFloat(lineStyle.fontSize || "0") || 16;
        const indentWidth = fontSize * 2;
        const annotationMeasure = txtMeasureAnnotationRef.current;
        const annotationNameEl = annotationMeasure.querySelector(".reading-annotation-name") as HTMLElement | null;
        const annotationTextEl = annotationMeasure.querySelector(".reading-annotation-text") as HTMLElement | null;
        const annotationMeasureStyle = window.getComputedStyle(annotationMeasure);
        const annotationMarginY =
            parseFloat(annotationMeasureStyle.marginTop || "0") +
            parseFloat(annotationMeasureStyle.marginBottom || "0");
        const chapterAnnotations = annotations.filter((annotation) => annotation.chapterIndex === chapterIndex);
        const annotationSignature = chapterAnnotations
            .map((annotation) => `${annotation.id}:${annotation.content.length}:${isAnnotationTranslationExpanded(annotation.id) ? 1 : 0}`)
            .join("|");
        const paragraphCharCount = currentChapter.paragraphs.reduce((sum, paragraph) => sum + paragraph.length, 0);
        const paginationSignature = [
            currentChapter.id,
            chapterIndex,
            currentChapter.paragraphs.length,
            paragraphCharCount,
            annotationSignature,
            bilingualTranslationEnabled ? 1 : 0,
            Math.round(maxWidth),
            Math.round(maxHeight),
            lineHeight,
            gapHeight,
            fontSize,
            lineStyle.fontFamily,
            lineStyle.fontWeight,
            lineStyle.fontStyle,
        ].join("::");

        if (lastTxtPaginationSignatureRef.current === paginationSignature) return;

        const measureAnnotationHeight = (annotation: ReadingAnnotation) => {
            if (!annotationNameEl || !annotationTextEl) return lineHeight * 2;
            annotationNameEl.textContent = annotation.characterName;
            const bilingual = bilingualTranslationEnabled ? splitBilingualText(annotation.content) : null;
            if (!bilingual) {
                annotationTextEl.textContent = annotation.content;
            } else {
                const expanded = isAnnotationTranslationExpanded(annotation.id);
                annotationTextEl.textContent = expanded
                    ? `${bilingual.original}\n收起中文\n${bilingual.translated}`
                    : `${bilingual.original}\n中文`;
            }
            const blockHeight = annotationMeasure.offsetHeight || lineHeight * 2;
            return blockHeight + annotationMarginY;
        };

        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        if (!ctx) {
            setTxtPages([[{ kind: "line", text: currentChapter.paragraphs.join(" "), chapterIndex, paragraphIndex: 0, indent: true }]]);
            return;
        }
        ctx.font = toCanvasFont(lineStyle);

        const tokens: TxtPageItem[] = [];
        const annotationMap = new Map<number, ReadingAnnotation[]>();
        for (const annotation of chapterAnnotations) {
            const list = annotationMap.get(annotation.paragraphIndex) || [];
            list.push(annotation);
            annotationMap.set(annotation.paragraphIndex, list);
        }

        currentChapter.paragraphs.forEach((paragraph, index) => {
            const segments = paragraph.split("\n");
            segments.forEach((segment, segmentIndex) => {
                const shouldIndent = segmentIndex === 0;
                const wrappedLines = wrapTextToLines(segment, maxWidth, ctx, shouldIndent ? indentWidth : 0);
                wrappedLines.forEach((line, lineIndex) => {
                    tokens.push({ kind: "line", text: line, chapterIndex, paragraphIndex: index, indent: shouldIndent && lineIndex === 0, segEnd: lineIndex === wrappedLines.length - 1 });
                });
                if (segmentIndex < segments.length - 1) tokens.push({ kind: "gap", chapterIndex, paragraphIndex: index });
            });
            const paragraphAnnotations = annotationMap.get(index) || [];
            for (const annotation of paragraphAnnotations) {
                tokens.push({ kind: "annotation", annotation, chapterIndex, paragraphIndex: index });
            }
            if (index < currentChapter.paragraphs.length - 1) tokens.push({ kind: "gap", chapterIndex, paragraphIndex: index });
        });

        const pages: TxtPageItem[][] = [];
        let currentPage: TxtPageItem[] = [];
        let usedHeight = 0;

        for (const token of tokens) {
            const tokenHeight = token.kind === "gap" ? gapHeight : token.kind === "annotation" ? measureAnnotationHeight(token.annotation) : lineHeight;
            if (token.kind === "gap" && currentPage.length === 0) continue;

            if (currentPage.length > 0 && usedHeight + tokenHeight > maxHeight) {
                pages.push(trimTrailingGaps(currentPage));
                currentPage = [];
                usedHeight = 0;
                if (token.kind === "gap") continue;
            }

            currentPage.push(token);
            usedHeight += tokenHeight;
        }

        const lastPage = trimTrailingGaps(currentPage);
        if (lastPage.length > 0) pages.push(lastPage);
        if (pages.length === 0) pages.push([{ kind: "line", text: "", chapterIndex, paragraphIndex: 0 }]);

        lastTxtPaginationSignatureRef.current = paginationSignature;
        setTxtPages(pages);
    }, [annotations, bilingualTranslationEnabled, chapterIndex, currentChapter, isAnnotationTranslationExpanded, isPdf, txtLayoutVersion]);

    const txtTotalPages = txtPagesReadyForCurrentChapter ? txtPages.length : 1;

    const navigateWithFlip = useCallback((direction: 'forward' | 'backward') => {
        if (flipAnim || isPdf) return;
        const currentItems = txtPages[txtPage];
        if (!currentItems || currentItems.length === 0) return;

        const canForward = txtPage < txtTotalPages - 1 || chapterIndex < chapters.length - 1;
        const canBackward = txtPage > 0 || chapterIndex > 0;
        if (direction === 'forward' && !canForward) return;
        if (direction === 'backward' && !canBackward) return;

        setFlipAnim({ direction, items: currentItems });

        if (direction === 'forward') {
            if (txtPage < txtTotalPages - 1) setTxtPage(p => p + 1);
            else goToChapter(chapterIndex + 1);
        } else {
            if (txtPage > 0) setTxtPage(p => p - 1);
            else goToChapter(chapterIndex - 1, true);
        }
    }, [flipAnim, isPdf, txtPages, txtPage, txtTotalPages, chapterIndex, chapters.length]);

    const switchReadingMode = useCallback((mode: "continuous" | "page") => {
        if (isPdf || isManga || mode === readingMode) return;
        const body = scrollRef.current;
        if (mode === "page") {
            if (body && txtPages.length > 1) {
                const max = Math.max(1, body.scrollHeight - body.clientHeight);
                const fraction = Math.max(0, Math.min(1, body.scrollTop / max));
                setTxtPage(Math.round(fraction * (txtPages.length - 1)));
            }
        } else {
            const fraction = txtPages.length > 1 ? txtPage / (txtPages.length - 1) : 0;
            initialTxtScrollFractionRef.current = fraction;
        }
        setReadingMode(mode);
        try { window.localStorage.setItem(`reading-mode:${book.id}`, mode); } catch { /* ignore */ }
    }, [book.id, isPdf, isManga, readingMode, txtPage, txtPages.length]);

    const handleReadingMarginChange = useCallback((value: number) => {
        const next = Math.max(8, Math.min(48, Math.round(value)));
        setReadingMargin(next);
        setTxtLayoutVersion(v => v + 1);
        try {
            if (sharedLayout) {
                window.localStorage.setItem("reading-shared-margin", String(next));
                window.dispatchEvent(new CustomEvent("reading-shared-layout-change", { detail: { margin: next } }));
            } else {
                window.localStorage.setItem(`reading-margin:${book.id}`, String(next));
            }
        } catch {}
    }, [book.id, sharedLayout]);

    const handleSharedLayoutChange = useCallback((enabled: boolean) => {
        try {
            if (enabled) {
                const common = Number(window.localStorage.getItem("reading-shared-margin"));
                const next = Number.isFinite(common) && common >= 8 && common <= 48 ? common : readingMargin;
                window.localStorage.setItem("reading-shared-margin", String(next));
                setReadingMargin(next);
            } else {
                const own = Number(window.localStorage.getItem(`reading-margin:${book.id}`));
                setReadingMargin(Number.isFinite(own) && own >= 8 && own <= 48 ? own : 24);
            }
            window.localStorage.setItem(`reading-shared-layout:${book.id}`, String(enabled));
        } catch {}
        setSharedLayout(enabled);
        setTxtLayoutVersion(v => v + 1);
    }, [book.id, readingMargin]);

    useEffect(() => {
        const handler = (event: Event) => {
            if (!sharedLayout) return;
            const margin = Number((event as CustomEvent<{ margin?: number }>).detail?.margin);
            if (margin >= 8 && margin <= 48) { setReadingMargin(margin); setTxtLayoutVersion(v => v + 1); }
        };
        window.addEventListener("reading-shared-layout-change", handler);
        return () => window.removeEventListener("reading-shared-layout-change", handler);
    }, [sharedLayout]);

    const txtDisplayedPage = Math.min(txtPage + 1, txtTotalPages);
    const currentPageCount = isPdf ? Math.max(1, pdfTotalPages || 1) : Math.max(1, txtTotalPages);
    const txtBookSliderMax = Math.max(1, chapters.length);
    const txtBookSliderValue = chapters.length > 0 ? chapterIndex + 1 : 1;
    useEffect(() => {
        if (isPdf) return;
        const pendingFraction = pendingTxtPageFractionRef.current;
        if (pendingFraction === null || txtPagesChapterIndex !== chapterIndex) return;

        setTxtPage(Math.round(pendingFraction * Math.max(0, txtTotalPages - 1)));
        pendingTxtPageFractionRef.current = null;
    }, [chapterIndex, isPdf, txtPagesChapterIndex, txtTotalPages]);

    useEffect(() => {
        if (chapters.length === 0) return;

        const chapterProgressFraction = isPdf
            ? (pdfTotalPages > 0 ? Math.min(1, Math.max(0, pdfCurrentPage / pdfTotalPages)) : 0)
            : Math.max(0, Math.min(1, initialTxtScrollFractionRef.current ?? 0));
        const progressFraction = isPdf
            ? chapterProgressFraction
            : Math.min(1, Math.max(0, (chapterIndex + chapterProgressFraction) / Math.max(1, chapters.length)));
        const progress: ReadingProgress = {
            bookId: book.id,
            chapterIndex,
            scrollPosition: isPdf ? Math.max(0, pdfCurrentPage - 1) : Math.round(chapterProgressFraction * 100000),
            companionCharacterId: companionId || undefined,
            progressFraction,
            progressCurrent: isPdf ? Math.max(1, pdfCurrentPage) : Math.max(1, Math.round(chapterProgressFraction * Math.max(1, currentChapter?.paragraphs.length || 1))),
            progressTotal: isPdf ? Math.max(1, pdfTotalPages || 1) : Math.max(1, currentChapter?.paragraphs.length || 1),
            progressScope: isPdf ? "book" : "chapter",
            lastReadAt: new Date().toISOString(),
        };
        saveProgress(progress);
    }, [book.id, chapterIndex, chapters.length, companionId, isPdf, pdfCurrentPage, pdfTotalPages, txtPage, txtTotalPages]);

    // DOM-based screen capture: reads actual visible paragraph elements via getBoundingClientRect.
    // Returns null if container or elements are not available.
    const captureVisibleParagraphs = useCallback((): { chapterIndex: number; paragraphIndex: number; text: string }[] | null => {
        const container = !isPdf ? scrollRef.current : readingContentRef.current;
        if (!container) return null;
        const containerRect = container.getBoundingClientRect();
        if (containerRect.width === 0 || containerRect.height === 0) return null;

        const elements = container.querySelectorAll('[data-paragraph-index]');
        if (elements.length === 0) return null;

        const visibleMap = new Map<string, { chapterIndex: number; paragraphIndex: number; text: string }>();
        elements.forEach((el) => {
            const rect = (el as HTMLElement).getBoundingClientRect();
            // Element is visible if it overlaps with the container viewport
            const isVisible = rect.bottom > containerRect.top + 1 && rect.top < containerRect.bottom - 1;
            if (!isVisible) return;

            const idx = parseInt(el.getAttribute('data-paragraph-index') || '', 10);
            const chapterIdx = parseInt(el.getAttribute('data-chapter-index') || String(chapterIndex), 10);
            if (!Number.isFinite(idx) || !Number.isFinite(chapterIdx)) return;

            const text = el.textContent?.trim() || '';
            const key = `${chapterIdx}:${idx}`;
            if (text && !visibleMap.has(key)) {
                visibleMap.set(key, { chapterIndex: chapterIdx, paragraphIndex: idx, text });
            }
        });

        if (visibleMap.size === 0) return null;
        return Array.from(visibleMap.values())
            .sort((a, b) => a.chapterIndex - b.chapterIndex || a.paragraphIndex - b.paragraphIndex);
    }, [chapterIndex, isPdf]);

    // Sync reading context to window.__readingScreenContext.
    // Layer 1: useMemo — writes state-based context synchronously during render (zero delay, before paint).
    useMemo(() => {
        if (chapters.length === 0) return;
        const ctx = buildDiscussContext();
        if (!ctx) return;
        const screenContext = {
            bookTitle: book.title,
            chapterTitle: ctx.chapterTitle,
            chapterContent: ctx.chapterContent,
            updatedAt: Date.now(),
        };
        try { (window as any).__readingScreenContext = screenContext; } catch { /* 静默 */ }
        try { kvSet("ai_phone_reading_context_v1", JSON.stringify(screenContext)); } catch { /* 静默 */ }
        return screenContext;
    }, [book.title, buildDiscussContext, chapters.length]);

    // Layer 2: useLayoutEffect — DOM-based screen capture via getBoundingClientRect.
    // Reads actual visible paragraph elements and corrects any state-vs-DOM discrepancy before paint.
    useLayoutEffect(() => {
        if (chapters.length === 0) return;
        const ctx = buildDiscussContext();
        if (!ctx) return;

        const visibleParagraphs = captureVisibleParagraphs();
        if (visibleParagraphs && visibleParagraphs.length > 0) {
            const currentVisibleParagraphs = visibleParagraphs.filter((p) => p.chapterIndex === chapterIndex);
            if (currentVisibleParagraphs.length === 0) return;
            const visibleIndexes = currentVisibleParagraphs.map(p => p.paragraphIndex);
            const firstIdx = visibleIndexes[0];
            const lastIdx = visibleIndexes[visibleIndexes.length - 1];
            const visibleContentLines = visibleParagraphs.map(p => `[${p.paragraphIndex + 1}] ${p.text}`).join('\n\n');

            const screenContext = {
                bookTitle: book.title,
                chapterTitle: ctx.chapterTitle,
                chapterContent: [
                    `当前阅读中心：段落${firstIdx + 1}-${lastIdx + 1}（DOM精确捕捉）`,
                    `本次上下文范围：段落${firstIdx + 1}-${lastIdx + 1}`,
                    '',
                    visibleContentLines,
                ].join('\n'),
                updatedAt: Date.now(),
            };
            try { (window as any).__readingScreenContext = screenContext; } catch { /* 静默 */ }
            try { kvSet("ai_phone_reading_context_v1", JSON.stringify(screenContext)); } catch { /* 静默 */ }
        }
        // If DOM capture fails, the useMemo layer already wrote the state-based context
    }, [book.title, buildDiscussContext, chapterIndex, chapters.length, captureVisibleParagraphs, txtPage, txtPages, isPdf, pdfCurrentPage]);

    useEffect(() => {
        setTxtPage((prev) => Math.min(prev, Math.max(0, txtTotalPages - 1)));
    }, [txtTotalPages]);

    // Continuous TXT reading: restore the previous approximate position and keep progress synced to scroll.
    useLayoutEffect(() => {
        if (isPdf || readingMode !== "continuous" || !chaptersLoaded || !currentChapter || !scrollRef.current) return;
        const body = scrollRef.current;
        const fraction = initialTxtScrollFractionRef.current;
        if (fraction !== null) {
            const apply = () => {
                body.scrollTop = Math.max(0, (body.scrollHeight - body.clientHeight) * fraction);
                initialTxtScrollFractionRef.current = null;
            };
            requestAnimationFrame(() => requestAnimationFrame(apply));
        }
    }, [chaptersLoaded, chapterIndex, currentChapter, isPdf, readingMode]);

    useEffect(() => {
        if (isPdf || readingMode !== "continuous" || !chaptersLoaded || !currentChapter || !scrollRef.current) return;
        const body = scrollRef.current;
        const onScroll = () => {
            const max = Math.max(1, body.scrollHeight - body.clientHeight);
            const fraction = Math.max(0, Math.min(1, body.scrollTop / max));
            initialTxtScrollFractionRef.current = fraction;
            const nextParagraph = captureVisibleParagraphs()?.find((item) => item.chapterIndex === chapterIndex)?.paragraphIndex ?? 0;
            setTxtPage(nextParagraph);
        };
        onScroll();
        body.addEventListener("scroll", onScroll, { passive: true });
        return () => body.removeEventListener("scroll", onScroll);
    }, [captureVisibleParagraphs, chapterIndex, chaptersLoaded, currentChapter, isPdf, readingMode]);

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    };

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (isPdf || readingMode !== "page") return;
        const start = touchStartRef.current;
        const touch = e.changedTouches[0];
        if (!touch) return;
        const dx = touch.clientX - start.x;
        const dy = touch.clientY - start.y;
        if (Math.abs(dy) < 35 || Math.abs(dy) < Math.abs(dx)) return;
        navigateWithFlip(dy < 0 ? "forward" : "backward");
    };

    const activeReadingMenuMessage = readingMessageMenu
        ? chatMessages.find((msg) => msg.id === readingMessageMenu.messageId) || null
        : null;

    return (
        <div className="reading-app-surface absolute inset-0 z-[100] flex flex-col bg-[var(--c-page-body-bg)]" data-immersive={immersive} style={{ paddingTop: "var(--page-header-safe-top, 48px)" }}>
            {/* Page flip overlay */}
            {flipAnim && (
                <>
                    <div
                        className={`reading-flip-overlay reading-flip-overlay--${flipAnim.direction}`}
                        onAnimationEnd={() => setFlipAnim(null)}
                    >
                        <div className="reading-flip-overlay-body">
                            {renderStaticPage(flipAnim.items)}
                        </div>
                    </div>
                    <div className={`reading-flip-shadow reading-flip-shadow--${flipAnim.direction}`} />
                </>
            )}

            {/* 阅读器唯一顶部层：返回 + 书名/章节信息 + 原有目录按钮。
                不再单独渲染“书籍信息”层。 */}
            <header className={`reading-header ${immersive ? "reading-header--immersive" : "reading-header--revealed"}`} data-ui="header">
                <div className="reading-header-top reading-header-top--single-row">
                    <button onClick={onBack} className="page-back-btn reading-header-back" aria-label="返回">
                        <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="15 18 9 12 15 6" />
                        </svg>
                    </button>
                    <div className="reading-header-title-group">
                        <strong className="reading-header-book-title">{book.title}</strong>
                        {!isPdf && currentChapter?.title && currentChapter.title !== book.title && (
                            <span className="reading-header-chapter-title">{currentChapter.title}</span>
                        )}
                    </div>
                    <div className="reading-header-right-group">
                        <button
                            type="button"
                            className="page-back-btn"
                            onClick={openNavigationDialog}
                            aria-label="目录"
                        >
                            <Menu size={18} strokeWidth={1.7} />
                        </button>
                    </div>
                </div>
                {annotationError && (
                    <div className="reading-header-status reading-header-status--floating" style={{ color: "var(--c-danger)" }}>{annotationError}</div>
                )}
            </header>

            {generating && (
                <div className="reading-status-float" aria-live="polite">
                    {companion?.name || "AI"} 正在批注中...
                </div>
            )}

            {/* Character picker dropdown — above bottom avatar */}
            {showCharPicker && (
                <div className="absolute inset-0 z-40" onClick={closeCharPicker} />
            )}
            {showCharPicker && (
                <div
                    className={`absolute left-3 z-50 g-card reading-char-picker ${charPickerClosing ? "reading-char-picker--closing" : ""}`}
                    style={{ minWidth: 160, bottom: `${charPickerBottom}px`, ...chatFloatingStyle, padding: "16px 16px 16px 24px" }}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="chat-contact-list" style={{ padding: "4px 6px" }}>
                        {enrichedContacts.map(c => (
                            <div
                                key={c.characterId}
                                className="chat-contact-item"
                                onClick={() => { setCompanionId(c.characterId); closeCharPicker(); generatedBatchesRef.current.clear(); }}
                            >
                                <div className="chat-contact-avatar"
                                    style={companionId === c.characterId ? { outline: "3px solid var(--c-success)", outlineOffset: "2px" } : undefined}
                                >
                                    {c.char.avatar ? <img src={c.char.avatar} alt="" /> : <span className="chat-contact-avatar-fallback">{c.char.name[0]}</span>}
                                </div>
                                <span className="chat-contact-name">{c.char.name}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* Reading content */}
            <div
                ref={scrollRef}
                className={`relative flex-1 min-h-0 px-4 pt-1 pb-3 ${isPdf ? "overflow-auto" : "overflow-y-auto overflow-x-hidden"}`}
                data-ui="body"
                onClick={handleReadingSurfaceClick}
            >
                {isPdf ? (
                    <>
                        {/* PDF native rendering */}
                        <PdfPageRenderer
                            bookId={book.id}
                            chapter={pdfAnnotationChapter}
                            annotations={pdfRenderAnnotations}
                            bilingualTranslationEnabled={bilingualTranslationEnabled}
                            collapseBilingualTranslation={readingConfig.collapseBilingualTranslation === true}
                            onTotalPages={setPdfTotalPages}
                            onCurrentPage={setPdfCurrentPage}
                            jumpToPage={pdfJumpPage}
                            onCopyAnnotation={copyToClipboard}
                            onDeleteAnnotation={(annotationId) => { void handleDeleteReadingAnnotation(annotationId); }}
                        />
                    </>
                ) : !chaptersLoaded ? (
                    null
                ) : chapters.length === 0 ? (
                    <div className="reading-debug-card">
                        <div className="reading-debug-title">TXT 数据自检</div>
                        <div className="reading-debug-line">本地章节数：0</div>
                        <div className="reading-debug-line">总段落数：0</div>
                        <div className="reading-debug-line">当前章节索引：{chapterIndex}</div>
                        <div className="reading-debug-line">当前页进度：{txtPage + 1}</div>
                        <div className="reading-debug-hint">这更像是这本书在本地 IndexedDB 里的章节数据已经空了，不是单纯分页卡住。</div>
                    </div>
                ) : !currentChapter ? (
                    <div className="reading-debug-card">
                        <div className="reading-debug-title">TXT 数据自检</div>
                        <div className="reading-debug-line">本地章节数：{chapters.length}</div>
                        <div className="reading-debug-line">总段落数：{totalParagraphs}</div>
                        <div className="reading-debug-line">当前章节索引：{chapterIndex}</div>
                        <div className="reading-debug-line">当前页进度：{txtPage + 1}/{txtTotalPages}</div>
                        <div className="reading-debug-hint">章节数据存在，但当前索引取不到正文。这个状态不是“正在加载”，而是本地章节数据和进度状态不一致。</div>
                    </div>
                ) : (
                    <>
                        <div
                            className="reading-continuous-stage" style={{ display: "block", minHeight: "max-content", height: "auto" }}
                            onTouchStart={handleTouchStart}
                            onTouchEnd={handleTouchEnd}
                        >
                            <div
                                className={readingMode === "continuous" ? "reading-continuous-surface" : "reading-page-surface"}
                                style={{ display: "block", height: "auto", minHeight: "max-content", paddingLeft: `${readingMargin}px`, paddingRight: `${readingMargin}px`, boxSizing: "border-box" }}
                            >
                                {chaptersLoaded ? (
                                    readingMode === "continuous"
                                        ? renderTxtChapter(currentChapter, chapterIndex)
                                        : renderTxtPage(txtPage)
                                ) : null}
                            </div>
                        </div>

                        <div className="reading-page-measure" aria-hidden="true">
                            <p ref={txtMeasureLineRef} className="reading-line">测</p>
                            <div ref={txtMeasureGapRef} className="reading-line-gap" />
                            <div ref={txtMeasureAnnotationRef} className="reading-annotation">
                                <span className="reading-annotation-name">角色</span>
                                <span className="reading-annotation-text">批注内容</span>
                            </div>
                        </div>
                    </>
                )}

                {showTxtLoading && (
                    <ReadingLoadingView
                        title={remoteContentLoading ? "正在读取在线正文" : "正在打开书页"}
                        subtitle={remoteContentLoading ? "正在获取当前章节内容" : "正在读取并排版当前章节"}
                        overlay
                    />
                )}
                {remoteContentError && !remoteContentLoading && (
                    <div className="reading-debug-card" style={{ margin: "16px" }}>
                        <div className="reading-debug-title">在线正文加载失败</div>
                        <div className="reading-debug-line">{remoteContentError}</div>
                        <div className="reading-debug-hint">请先确认书源登录状态和网络连接，然后重新打开章节。</div>
                    </div>
                )}

                {isPdf && <div className="h-[88px]" />}
            </div>

            {/* Immersive Page Number */}
            <span className={`reading-immersive-page ${immersive ? 'opacity-35' : 'opacity-0'}`}>
                {isPdf ? `${pdfCurrentPage}/${pdfTotalPages || "?"}` : `第${chapterIndex + 1}/${chapters.length}章`}
            </span>

            {/* Bottom bar — mirrors header style */}
            <footer className="reading-footer">
                <div className="reading-footer-inner">
                    <div className="reading-footer-slider-row">
                        <button
                            className="reading-footer-text-btn"
                            onClick={() => handleNavChapterClick(Math.max(0, chapterIndex - 1))}
                            disabled={chapterIndex <= 0}
                        >
                            上一章
                        </button>
                        <div className="reading-footer-slider">
                            {(() => {
                                const currentVal = isPdf ? pdfCurrentPage : txtBookSliderValue;
                                const maxVal = isPdf ? Math.max(1, currentPageCount) : txtBookSliderMax;
                                const progressPct = maxVal > 1 ? ((currentVal - 1) / (maxVal - 1)) * 100 : 0;
                                return (
                                    <input
                                        type="range"
                                        className="reading-custom-slider"
                                        min={1}
                                        max={maxVal}
                                        step={isPdf ? 1 : 0.001}
                                        value={currentVal}
                                        onChange={(e) => handleNavPageSlider(Number(e.target.value))}
                                        aria-label={isPdf ? "跳转页码" : "跳转阅读进度"}
                                        style={{ '--slider-progress': `${progressPct}%` } as React.CSSProperties}
                                    />
                                );
                            })()}
                        </div>
                        <button
                            className="reading-footer-text-btn"
                            onClick={() => handleNavChapterClick(Math.min(chapters.length - 1, chapterIndex + 1))}
                            disabled={chapterIndex >= chapters.length - 1}
                        >
                            下一章
                        </button>
                    </div>
                    <div className="reading-footer-actions">
                        <button
                            type="button"
                            className={`reading-footer-icon-btn ${autoAnnotate ? "is-active" : ""}`}
                            onClick={() => openAnnotationDialog("auto")}
                        >
                            <Bot size={22} strokeWidth={1.7} />
                            <span>自动批注</span>
                        </button>
                        <button
                            type="button"
                            className="reading-footer-icon-btn"
                            onClick={() => openAnnotationDialog("manual")}
                            disabled={generating || !companionId}
                        >
                            <PenLine size={22} strokeWidth={1.7} />
                            <span>写批注</span>
                        </button>
                        <button
                            type="button"
                            className="reading-footer-icon-btn"
                            onClick={() => setShowReadingInterface(true)}
                        >
                            <Settings2 size={22} strokeWidth={1.7} />
                            <span>界面</span>
                        </button>
                        <button
                            type="button"
                            className="reading-footer-icon-btn"
                            onClick={() => setShowReadingSettings(true)}
                        >
                            <Languages size={22} strokeWidth={1.7} />
                            <span>设置</span>
                        </button>
                    </div>
                </div>
            </footer>

            {!showChat && (
                <button
                    onClick={handleChatLaunchClick}
                    className="reading-chat-launch"
                    aria-label="打开聊天悬浮窗"
                    title="打开聊天悬浮窗"
                    style={chatFloatingStyle}
                    onPointerDown={handleChatDragStart}
                    onPointerMove={handleChatDragMove}
                    onPointerUp={handleChatDragEnd}
                    onPointerCancel={handleChatDragEnd}
                >
                    {companion?.avatar ? (
                        <img src={companion.avatar} alt="" className="w-full h-full object-cover rounded-full" />
                    ) : (
                        <span className="ts-13">{companion?.name?.[0] || "?"}</span>
                    )}
                </button>
            )}

            {showChat && (
                <div
                    className={`reading-chat-float ${chatExpanded ? "reading-chat-float-expanded" : ""}${chatClosing ? " reading-chat-float--closing" : ""}`}
                    style={chatFloatingStyle}
                    onPointerDown={handleChatDragStart}
                    onPointerMove={handleChatDragMove}
                    onPointerUp={handleChatDragEnd}
                    onPointerCancel={handleChatDragEnd}
                >
                    {!chatExpanded ? (
                        <div className="reading-chat-float-compact">
                            <button
                                type="button"
                                onClick={() => { if (shouldIgnoreChatAction()) return; setShowCharPicker(!showCharPicker); }}
                                className="reading-bottom-avatar"
                            >
                                {companion?.avatar ? (
                                    <img src={companion.avatar} alt="" className="w-full h-full object-cover rounded-full" />
                                ) : (
                                    <span className="ts-12">{companion?.name?.[0] || "?"}</span>
                                )}
                            </button>
                            <button
                                type="button"
                                className="reading-chat-float-trigger"
                                onClick={() => { if (shouldIgnoreChatAction()) return; setChatExpanded(true); closeCharPicker(); }}
                                disabled={!companionId}
                            >
                                {companion ? `和${companion.name}讨论该章节...` : "选择陪读角色"}
                                {chatMessages.length > 0 && <span className="ml-1 ts-11 text-[var(--c-icon-active)]">({chatMessages.length})</span>}
                            </button>
                            <button type="button" onClick={() => { if (shouldIgnoreChatAction()) return; handleCloseChat(); }} className="reading-chat-float-close" aria-label="关闭聊天悬浮窗"><ChevronRight size={16} strokeWidth={2} /></button>
                        </div>
                    ) : (
                        <>
                            <div className="reading-chat-float-header">
                                <div className="reading-bottom-avatar">
                                    {companion?.avatar ? (
                                        <img src={companion.avatar} alt="" className="w-full h-full object-cover rounded-full" />
                                    ) : (
                                        <span className="ts-12">{companion?.name?.[0] || "?"}</span>
                                    )}
                                </div>
                                <div className="reading-chat-float-header-copy">
                                    <span className="reading-chat-float-title">和{companion?.name || "AI"}讨论该章节</span>
                                    <span className="reading-chat-float-subtitle">拖拽任意位置移动</span>
                                </div>
                                <button type="button" onClick={() => { if (shouldIgnoreChatAction()) return; setChatExpanded(false); }} className="reading-chat-float-close" aria-label="收起聊天窗口"><ChevronDown size={18} strokeWidth={2} /></button>
                                <button type="button" onClick={() => { if (shouldIgnoreChatAction()) return; handleCloseChat(); }} className="reading-chat-float-close" aria-label="关闭聊天悬浮窗"><Minus size={18} strokeWidth={2} /></button>
                            </div>
                            <div className="reading-chat-float-body" onClick={() => {
                                if (activeMessageId || readingMessageMenu) closeReadingMessageMenu();
                                if (activeAnnotationId) setActiveAnnotationId(null);
                            }} onScroll={() => {
                                if (readingMessageMenu) closeReadingMessageMenu();
                            }}>
                                {chatMessages.length === 0 && (
                                    <div className="text-center ts-13 text-[var(--c-icon)] py-6">和{companion?.name}聊聊这章内容吧</div>
                                )}
                                {chatMessages.map(msg => {
                                    // 渲染时过滤系统内容：确保旧消息和来自聊天APP的消息也能被清理
                                    const displayMsg = (msg.content && /<action_result|<system|<instruction|以下是系统处理结果|请基于以上结果|不要重复你之前|不要再次执行/.test(msg.content))
                                        ? { ...msg, content: filterSystemContent(msg.content) }
                                        : msg;
                                    // 过滤后内容为空则跳过显示
                                    if (!displayMsg.content?.trim() && !displayMsg.mediaType) return null;
                                    return (
                                    <div key={displayMsg.id} className="chat-msg-wrapper" data-role={displayMsg.role}
                                        onPointerDown={(e) => { e.stopPropagation(); handleReadingMessagePointerDown(e, displayMsg); }}
                                        onPointerUp={(e) => { e.stopPropagation(); cancelReadingMessageLongPress(); }}
                                        onPointerCancel={cancelReadingMessageLongPress}
                                        onPointerLeave={cancelReadingMessageLongPress}
                                        onPointerMove={handleReadingMessagePointerMove}
                                        onContextMenu={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            cancelReadingMessageLongPress();
                                            setActiveAnnotationId(null);
                                            setActiveMessageId(displayMsg.id);
                                            setReadingMessageMenu({ messageId: displayMsg.id, x: e.clientX, y: e.clientY });
                                        }}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            if (readingMessageMenu && readingMessageMenu.messageId !== displayMsg.id) closeReadingMessageMenu();
                                        }}
                                    >
                                        <div className={`chat-bubble-role-${displayMsg.role} rounded-lg ${displayMsg.mediaType && ["sticker", "red_packet", "transfer", "image", "location", "music_share", "xiaohongshu_note_share"].includes(displayMsg.mediaType) ? "chat-bubble-media" : "max-w-[80%]"} break-words relative`}
                                            data-ui={displayMsg.role === "user" ? "bubble-user" : "bubble-bot"}
                                            {...(activeMessageId === displayMsg.id ? { "data-active": "" } : {})}>
                                            <MessageBubble
                                                msg={displayMsg}
                                                charName={companion?.name}
                                                userName=""
                                                characterId={companionId || undefined}
                                                onUpdate={m => setChatMessages(prev => prev.map(p => p.id === m.id ? m : p))}
                                                defaultTranslationExpanded={defaultTranslationExpanded}
                                            />
                                        </div>
                                    </div>
                                    );
                                })}
                                {chatting && <div className="ts-13 text-[var(--c-icon)] py-1">{companion?.name} 正在思考...</div>}
                            </div>
                            <div className="reading-chat-float-input">
                                <input
                                    value={chatInput}
                                    onChange={e => setChatInput(e.target.value)}
                                    onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } }}
                                    placeholder="输入消息..."
                                    className="ui-input flex-1"
                                    disabled={chatting}
                                />
                                <button
                                    onClick={handleSend}
                                    disabled={!chatInput.trim() || chatting}
                                    className="reading-chat-send-btn"
                                    aria-label="发送"
                                ><SendHorizontal size={18} strokeWidth={1.8} /></button>
                            </div>
                        </>
                    )}
                </div>
            )}

            {activeReadingMenuMessage && readingMessageMenu && (
                <div
                    className="ctx-menu chat-floating-ctx-menu reading-chat-context-menu flex py-[6px] px-0"
                    data-role={activeReadingMenuMessage.role}
                    style={getReadingMessageMenuStyle(readingMessageMenu)}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => e.stopPropagation()}
                >
                    <button
                        type="button"
                        onClick={() => {
                            copyToClipboard(activeReadingMenuMessage.content);
                            closeReadingMessageMenu();
                        }}
                        className="ctx-menu-btn"
                    >复制</button>
                    <button
                        type="button"
                        onClick={() => handleEditDiscussMessageStart(activeReadingMenuMessage)}
                        className="ctx-menu-btn"
                    >编辑</button>
                    <button
                        type="button"
                        onClick={() => {
                            deleteChatMessage(activeReadingMenuMessage.id);
                            setChatMessages((prev) => prev.filter((msg) => msg.id !== activeReadingMenuMessage.id));
                            closeReadingMessageMenu();
                        }}
                        className="ctx-menu-btn ctx-menu-btn-danger"
                    >删除</button>
                </div>
            )}

            {editingDiscussMessage && (
                <ContentDialog
                    title="编辑共读消息"
                    confirmLabel="保存"
                    cancelLabel="取消"
                    onConfirm={handleSaveDiscussMessageEdit}
                    onCancel={() => {
                        setEditingDiscussMessage(null);
                        setEditingDiscussContent("");
                    }}
                >
                    <div className="reading-discuss-edit">
                        <textarea
                            className="ui-textarea reading-discuss-edit-textarea"
                            value={editingDiscussContent}
                            onChange={(event) => setEditingDiscussContent(event.target.value)}
                            rows={6}
                        />
                    </div>
                </ContentDialog>
            )}

            {annotationDialogMode && (
                <ContentDialog
                    title={annotationDialogMode === "manual" ? "生成批注" : autoAnnotate ? "关闭自动批注" : "开启自动批注"}
                    confirmLabel={annotationDialogMode === "manual" ? "生成" : autoAnnotate ? "关闭" : "开启"}
                    cancelLabel="取消"
                    onConfirm={() => { void handleAnnotationDialogConfirm(); }}
                    onCancel={() => setAnnotationDialogMode(null)}
                >
                    <div className="reading-settings-grid">
                        {annotationDialogMode === "auto" && autoAnnotate ? (
                            <>
                                <div className="reading-settings-inline-note">
                                    <span>当前状态</span>
                                    <span>自动批注已开启</span>
                                </div>
                                <div className="reading-settings-inline-note">
                                    <span>批注单位</span>
                                    <span>{annotationBatchSize}{isPdf ? " 页" : " 段"}</span>
                                </div>
                            </>
                        ) : (
                            <>
                                <label className="reading-settings-label">
                                    <span>
                                        {annotationDialogMode === "manual"
                                            ? (isPdf
                                                ? `确认让${companion?.name || "AI"}为接下来几页生成批注`
                                                : `确认让${companion?.name || "AI"}为接下来几个段落生成批注`)
                                            : (isPdf
                                                ? `开启后，先生成当前页所在批次；之后翻到新批次第一页时自动生成批注`
                                                : `开启后，先生成当前段落所在批次；之后翻到新批次第一页时自动生成批注`)}
                                    </span>
                                    <input
                                        value={annotationBatchInput}
                                        onChange={(e) => setAnnotationBatchInput(e.target.value.replace(/[^\d]/g, ""))}
                                        className="ui-input"
                                        inputMode="numeric"
                                    />
                                </label>
                                <div className="reading-settings-inline-note">
                                    <span>默认值</span>
                                    <span>{isPdf ? "5 页" : "50 段"}</span>
                                </div>
                            </>
                        )}
                    </div>
                </ContentDialog>
            )}
            {showReadingInterface && (
                <ContentDialog
                    title="界面"
                    confirmLabel="完成"
                    cancelLabel="关闭"
                    onConfirm={() => setShowReadingInterface(false)}
                    onCancel={() => setShowReadingInterface(false)}
                >
                    <div className="reading-settings-grid">
                        {!isPdf && (
                            <>
                                <div className="reading-settings-group">
                                    <div className="reading-settings-heading">
                                        <BookOpenText size={17} strokeWidth={1.8} />
                                        <span>阅读模式</span>
                                    </div>
                                    <div className="reading-settings-actions">
                                        <button type="button" className={`ui-btn ${readingMode === "continuous" ? "reading-footer-btn-active" : ""}`} onClick={() => switchReadingMode("continuous")}>连续滚动</button>
                                        <button type="button" className={`ui-btn ${readingMode === "page" ? "reading-footer-btn-active" : ""}`} onClick={() => switchReadingMode("page")}>翻页模式</button>
                                    </div>
                                </div>
                                <div className="reading-settings-group">
                                    <div className="reading-settings-inline-note">
                                        <div>
                                            <div className="reading-settings-heading" style={{ marginBottom: 2 }}><span>共享布局</span></div>
                                            <div style={{ fontSize: 12, opacity: 0.72 }}>开启后，所有开启共享布局的书籍使用同一边距</div>
                                        </div>
                                        <Toggle checked={sharedLayout} onChange={handleSharedLayoutChange} />
                                    </div>
                                    <div className="reading-settings-heading"><span>正文左右边距</span><span>{readingMargin}px</span></div>
                                    <input type="range" min={8} max={48} step={2} value={readingMargin} onChange={e => handleReadingMarginChange(Number(e.target.value))} className="reading-custom-slider" aria-label="正文左右边距" />
                                    <div className="reading-settings-inline-note"><span>窄</span><span>左右各 {readingMargin}px</span><span>宽</span></div>
                                </div>
                            </>
                        )}
                    </div>
                </ContentDialog>
            )}
            {showReadingSettings && (
                <ContentDialog
                    title="阅读双语翻译"
                    confirmLabel="完成"
                    cancelLabel="关闭"
                    onConfirm={() => setShowReadingSettings(false)}
                    onCancel={() => setShowReadingSettings(false)}
                >
                    <div className="reading-settings-grid">
                        <div className="reading-settings-inline-note">
                            <span>启用阅读双语翻译</span>
                            <Toggle
                                checked={bilingualTranslationEnabled}
                                onChange={(checked) => {
                                    const next = { ...readingConfig, bilingualTranslationEnabled: checked };
                                    setReadingConfig(next);
                                    saveReadingInteractionConfig(next);
                                }}
                            />
                        </div>
                        <div className="reading-settings-inline-note">
                            <span>折叠中文译文</span>
                            <Toggle
                                checked={readingConfig.collapseBilingualTranslation === true}
                                onChange={(checked) => {
                                    const next = { ...readingConfig, collapseBilingualTranslation: checked };
                                    setReadingConfig(next);
                                    saveReadingInteractionConfig(next);
                                }}
                            />
                        </div>
                        <div className="reading-settings-inline-note">
                            <span>说明</span>
                            <span>只翻译 AI 讨论消息和 AI 批注，不翻书正文</span>
                        </div>
                        {bilingualTranslationEnabled && (
                            <div className="reading-settings-prompt">
                                <div className="reading-settings-prompt-head">
                                    <span>双语提示词</span>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const next = {
                                                ...readingConfig,
                                                bilingualTranslationPrompt: DEFAULT_READING_INTERACTION_CONFIG.bilingualTranslationPrompt,
                                            };
                                            setReadingConfig(next);
                                            saveReadingInteractionConfig(next);
                                        }}
                                    >
                                        恢复默认
                                    </button>
                                </div>
                                <textarea
                                    className="ui-input"
                                    rows={7}
                                    value={readingConfig.bilingualTranslationPrompt}
                                    onChange={(event) => {
                                        const next = { ...readingConfig, bilingualTranslationPrompt: event.target.value };
                                        setReadingConfig(next);
                                        saveReadingInteractionConfig(next);
                                    }}
                                />
                            </div>
                        )}
                    </div>
                </ContentDialog>
            )}
            {showNavigationDialog && (
                <>
                    <div className="reading-nav-backdrop" onClick={() => setShowNavigationDialog(false)} />
                    <aside className="reading-nav-drawer">
                        <header className="reading-nav-header">
                            <span className="reading-nav-title">导航</span>
                            <button type="button" className="reading-nav-close" onClick={() => setShowNavigationDialog(false)} aria-label="关闭">
                                <X size={18} strokeWidth={2} />
                            </button>
                        </header>
                        <div className="reading-nav-chapter-count">共{chapters.length}章</div>
                        <div className="reading-nav-chapter-list">
                            {chapters.map((chapter, index) => {
                                const charCount = chapter.paragraphs.reduce((sum, p) => sum + p.replace(/\s+/g, "").length, 0);
                                const pageLabel = isPdf && chapter.pageStart ? chapter.pageStart : null;
                                return (
                                    <button
                                        key={chapter.id}
                                        type="button"
                                        className={`reading-nav-chapter-item${index === chapterIndex ? " is-active" : ""}`}
                                        onClick={() => handleNavChapterClick(index)}
                                    >
                                        <div className="reading-nav-chapter-main">
                                            <span className="reading-nav-chapter-name">{chapter.title || `第${index + 1}章`}</span>
                                            <span className="reading-nav-chapter-meta">{charCount > 0 ? `${charCount}字` : ""}</span>
                                        </div>
                                        {pageLabel && <span className="reading-nav-chapter-page">{pageLabel}</span>}
                                    </button>
                                );
                            })}
                        </div>
                    </aside>
                </>
            )}
        </div>
    );
}
