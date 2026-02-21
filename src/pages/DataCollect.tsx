import React, { useState, useRef, useCallback } from 'react';

interface CollectedSample {
    id: string;
    imageDataUrl: string;
    label: '정상' | '이상';
    pillCount: number;
    bagCount: number;
    timestamp: number;
    note: string;
}

const STORAGE_KEY = 'pharmacy_collected_data';

const loadSamples = (): CollectedSample[] => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
};

const saveSamples = (samples: CollectedSample[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(samples));
};

export const DataCollect: React.FC = () => {
    const [samples, setSamples] = useState<CollectedSample[]>(loadSamples);
    const [capturedImage, setCapturedImage] = useState<string | null>(null);
    const [label, setLabel] = useState<'정상' | '이상'>('정상');
    const [pillCount, setPillCount] = useState(5);
    const [bagCount, setBagCount] = useState(10);
    const [note, setNote] = useState('');
    const [showCamera, setShowCamera] = useState(false);
    const [showGallery, setShowGallery] = useState(false);
    const videoRef = useRef<HTMLVideoElement>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const startCamera = async () => {
        setShowCamera(true);
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'environment', width: { ideal: 1920 }, height: { ideal: 1080 } }
            });
            streamRef.current = stream;
            if (videoRef.current) {
                videoRef.current.srcObject = stream;
                videoRef.current.play();
            }
        } catch (err) {
            alert('카메라 접근 실패: ' + (err as Error).message);
            setShowCamera(false);
        }
    };

    const stopCamera = () => {
        streamRef.current?.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        setShowCamera(false);
    };

    const capturePhoto = () => {
        if (!videoRef.current) return;
        const canvas = document.createElement('canvas');
        canvas.width = videoRef.current.videoWidth;
        canvas.height = videoRef.current.videoHeight;
        const ctx = canvas.getContext('2d');
        if (ctx) {
            ctx.drawImage(videoRef.current, 0, 0);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            setCapturedImage(dataUrl);
            stopCamera();
        }
    };

    const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            setCapturedImage(ev.target?.result as string);
        };
        reader.readAsDataURL(file);
    }, []);

    const saveSample = () => {
        if (!capturedImage) return;
        const newSample: CollectedSample = {
            id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
            imageDataUrl: capturedImage,
            label,
            pillCount,
            bagCount,
            timestamp: Date.now(),
            note
        };
        const updated = [...samples, newSample];
        setSamples(updated);
        saveSamples(updated);
        setCapturedImage(null);
        setNote('');
    };

    const deleteSample = (id: string) => {
        const updated = samples.filter(s => s.id !== id);
        setSamples(updated);
        saveSamples(updated);
    };

    const exportData = () => {
        const exportObj = {
            version: '1.0',
            exportDate: new Date().toISOString(),
            totalSamples: samples.length,
            normalCount: samples.filter(s => s.label === '정상').length,
            abnormalCount: samples.filter(s => s.label === '이상').length,
            samples: samples.map(s => ({
                id: s.id,
                label: s.label,
                pillCount: s.pillCount,
                bagCount: s.bagCount,
                note: s.note,
                timestamp: s.timestamp,
                imageSize: s.imageDataUrl.length
            }))
        };
        const blob = new Blob([JSON.stringify(exportObj, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `pill_dataset_${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    const normalCount = samples.filter(s => s.label === '정상').length;
    const abnormalCount = samples.filter(s => s.label === '이상').length;

    // Camera capture view
    if (showCamera) {
        return (
            <div style={{ height: '100%', display: 'flex', flexDirection: 'column', background: '#000' }}>
                <video ref={videoRef} playsInline autoPlay muted
                    style={{ flex: 1, objectFit: 'cover', width: '100%' }} />
                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', padding: '12px', background: 'rgba(0,0,0,0.8)' }}>
                    <button className="btn" style={{ background: 'var(--panel-bg)' }} onClick={stopCamera}>취소</button>
                    <button className="btn scan-btn" onClick={capturePhoto}>📸 촬영</button>
                </div>
            </div>
        );
    }

    // Labeling view after capture
    if (capturedImage) {
        return (
            <div style={{ height: '100%', display: 'flex', gap: '12px', padding: '12px', overflow: 'hidden' }}>
                {/* Left: Image preview */}
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111', borderRadius: '12px', overflow: 'hidden' }}>
                    <img src={capturedImage} alt="촬영된 이미지"
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }} />
                </div>

                {/* Right: Labeling form */}
                <div className="glass-panel" style={{ width: '280px', padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    <h3 style={{ fontSize: '1rem', margin: 0 }}>📋 라벨링</h3>

                    {/* Label toggle */}
                    <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>판정</div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <button className="btn" onClick={() => setLabel('정상')}
                                style={{
                                    flex: 1, padding: '8px',
                                    background: label === '정상' ? 'var(--accent-green)' : 'var(--panel-bg)',
                                    fontSize: '0.9rem', fontWeight: label === '정상' ? 700 : 400
                                }}>
                                ✅ 정상
                            </button>
                            <button className="btn" onClick={() => setLabel('이상')}
                                style={{
                                    flex: 1, padding: '8px',
                                    background: label === '이상' ? 'var(--accent-red)' : 'var(--panel-bg)',
                                    fontSize: '0.9rem', fontWeight: label === '이상' ? 700 : 400
                                }}>
                                ❌ 이상
                            </button>
                        </div>
                    </div>

                    {/* Pill count */}
                    <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>봉지당 알약 수 (기대값)</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button className="btn" style={{ padding: '4px 12px', background: 'var(--panel-bg)' }}
                                onClick={() => setPillCount(Math.max(1, pillCount - 1))}>−</button>
                            <span style={{ fontSize: '1.3rem', fontWeight: 700, minWidth: '40px', textAlign: 'center' }}>{pillCount}</span>
                            <button className="btn" style={{ padding: '4px 12px', background: 'var(--panel-bg)' }}
                                onClick={() => setPillCount(pillCount + 1)}>+</button>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>알</span>
                        </div>
                    </div>

                    {/* Bag count */}
                    <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>봉지 수</div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button className="btn" style={{ padding: '4px 12px', background: 'var(--panel-bg)' }}
                                onClick={() => setBagCount(Math.max(1, bagCount - 1))}>−</button>
                            <span style={{ fontSize: '1.3rem', fontWeight: 700, minWidth: '40px', textAlign: 'center' }}>{bagCount}</span>
                            <button className="btn" style={{ padding: '4px 12px', background: 'var(--panel-bg)' }}
                                onClick={() => setBagCount(bagCount + 1)}>+</button>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>봉지</span>
                        </div>
                    </div>

                    {/* Note */}
                    <div>
                        <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>메모 (선택)</div>
                        <input type="text" value={note} onChange={e => setNote(e.target.value)}
                            placeholder="예: 8번 봉지 1알 부족"
                            style={{
                                width: '100%', padding: '8px', borderRadius: '6px',
                                border: '1px solid var(--panel-border)', background: 'rgba(0,0,0,0.3)',
                                color: 'var(--text-primary)', fontSize: '0.85rem', fontFamily: 'var(--font-base)'
                            }} />
                    </div>

                    <div style={{ flex: 1 }} />

                    {/* Actions */}
                    <button className="btn" onClick={saveSample}
                        style={{ width: '100%', background: 'var(--accent-blue)', fontWeight: 600 }}>
                        💾 저장
                    </button>
                    <button className="btn" onClick={() => setCapturedImage(null)}
                        style={{ width: '100%', background: 'var(--panel-bg)', fontSize: '0.85rem' }}>
                        취소
                    </button>
                </div>
            </div>
        );
    }

    // Gallery view
    if (showGallery) {
        return (
            <div style={{ height: '100%', overflow: 'auto', padding: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ margin: 0, fontSize: '1rem' }}>📁 수집된 데이터 ({samples.length}장)</h3>
                    <button className="btn" style={{ padding: '4px 12px', fontSize: '0.8rem', background: 'var(--panel-bg)' }}
                        onClick={() => setShowGallery(false)}>
                        ← 돌아가기
                    </button>
                </div>

                {samples.length === 0 ? (
                    <p style={{ color: 'var(--text-secondary)', textAlign: 'center', marginTop: '40px' }}>
                        아직 수집된 데이터가 없습니다
                    </p>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: '8px' }}>
                        {samples.map(s => (
                            <div key={s.id} className="glass-panel" style={{
                                overflow: 'hidden',
                                border: `1px solid ${s.label === '정상' ? 'var(--accent-green)' : 'var(--accent-red)'}`
                            }}>
                                <img src={s.imageDataUrl} alt={s.label}
                                    style={{ width: '100%', height: '100px', objectFit: 'cover' }} />
                                <div style={{ padding: '8px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <span style={{
                                            fontSize: '0.75rem', fontWeight: 600,
                                            color: s.label === '정상' ? 'var(--accent-green)' : 'var(--accent-red)'
                                        }}>
                                            {s.label}
                                        </span>
                                        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginLeft: '8px' }}>
                                            {s.pillCount}알×{s.bagCount}봉지
                                        </span>
                                    </div>
                                    <button onClick={() => deleteSample(s.id)}
                                        style={{ background: 'none', border: 'none', color: 'var(--accent-red)', cursor: 'pointer', fontSize: '0.9rem' }}>
                                        🗑
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        );
    }

    // Main data collection dashboard
    return (
        <div style={{ height: '100%', overflow: 'auto', padding: '16px' }}>
            <input type="file" ref={fileInputRef} accept="image/*" capture="environment"
                style={{ display: 'none' }} onChange={handleFileUpload} />

            <div style={{ marginBottom: '16px' }}>
                <h2 style={{ fontSize: '1.1rem', marginBottom: '4px' }}>📷 데이터 수집</h2>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                    약봉지 사진을 촬영하고 정상/이상 라벨을 지정하세요
                </p>
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <div className="glass-panel" style={{ flex: 1, padding: '12px', textAlign: 'center' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700 }}>{samples.length}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>총 수집</div>
                </div>
                <div className="glass-panel" style={{ flex: 1, padding: '12px', textAlign: 'center', borderColor: 'rgba(16,185,129,0.3)' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-green)' }}>{normalCount}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>정상</div>
                </div>
                <div className="glass-panel" style={{ flex: 1, padding: '12px', textAlign: 'center', borderColor: 'rgba(239,68,68,0.3)' }}>
                    <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent-red)' }}>{abnormalCount}</div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>이상</div>
                </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '16px' }}>
                <button className="btn scan-btn" style={{ flex: 1 }} onClick={startCamera}>
                    📸 카메라 촬영
                </button>
                <button className="btn" style={{ flex: 1, background: 'var(--accent-blue)' }}
                    onClick={() => fileInputRef.current?.click()}>
                    🖼 갤러리에서 선택
                </button>
            </div>

            <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn" style={{ flex: 1, background: 'var(--panel-bg)' }}
                    onClick={() => setShowGallery(true)}>
                    📁 수집 데이터 보기 ({samples.length})
                </button>
                {samples.length > 0 && (
                    <button className="btn" style={{ flex: 1, background: 'var(--panel-bg)' }}
                        onClick={exportData}>
                        📤 데이터 내보내기 (JSON)
                    </button>
                )}
            </div>
        </div>
    );
};
