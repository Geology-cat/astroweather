// 登録地点の一覧（カテゴリごとのグループ表示・地図での表示切替・一括削除・移動）。
import { useEffect, useMemo, useRef, useState } from 'react';
import { isSubmitEnter } from '../lib/keyboard';
import { MAX_CATEGORY_NAME_LENGTH, UNCATEGORIZED, categoryOf, formatLatLon, type Category, type Place } from '../lib/storage';
import type { PlaceStore } from '../lib/usePlaces';
import { Icon } from './Icon';

export const UNCATEGORIZED_LABEL = '未分類';

/** カテゴリ名の入力欄（作成・名前変更で共用）。Enter で確定、Esc で取り消し */
export function CategoryNameForm({
  initial = '',
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: string;
  submitLabel: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial);
  const submit = () => {
    if (name.trim()) onSubmit(name);
  };
  return (
    <span className="cat-form">
      <input
        type="text"
        className="input cat-input"
        placeholder="カテゴリ名（例：道北の遠征地）"
        maxLength={MAX_CATEGORY_NAME_LENGTH}
        value={name}
        autoFocus
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (isSubmitEnter(e)) {
            e.preventDefault();
            submit();
          } else if (e.key === 'Escape') {
            onCancel();
          }
        }}
        aria-label="カテゴリ名"
      />
      <button type="button" className="btn primary sm" onClick={submit} disabled={!name.trim()}>
        {submitLabel}
      </button>
      <button type="button" className="btn ghost sm" onClick={onCancel}>
        キャンセル
      </button>
    </span>
  );
}

/** カテゴリの選択肢（未分類＋作成済みカテゴリ） */
export function CategoryOptions({ categories }: { categories: Category[] }) {
  return (
    <>
      <option value={UNCATEGORIZED}>{UNCATEGORIZED_LABEL}</option>
      {categories.map((c) => (
        <option key={c.id} value={c.id}>
          {c.name}
        </option>
      ))}
    </>
  );
}

interface Group {
  id: string;
  name: string;
  places: Place[];
}

interface Props {
  store: PlaceStore;
  selectedId: string;
  onSelectPlace: (id: string) => void;
  /** カテゴリを作成したとき（登録先をそのカテゴリに切り替えるため） */
  onCategoryCreated: (id: string) => void;
  /** このカテゴリへ KML / KMZ を読み込む（ファイル選択を開く） */
  onImportTo: (categoryId: string) => void;
  /** このカテゴリへファイルがドロップされた */
  onDropFileTo: (file: File, categoryId: string) => void;
}

export function PlaceList({ store, selectedId, onSelectPlace, onCategoryCreated, onImportTo, onDropFileTo }: Props) {
  const { places, categories, hiddenCategoryIds } = store;
  const [creating, setCreating] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [selectMode, setSelectMode] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(() => new Set());
  const [moveTarget, setMoveTarget] = useState<string>(UNCATEGORIZED);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const groups: Group[] = useMemo(() => {
    const byCat = new Map<string, Place[]>();
    places.forEach((p) => {
      const id = categoryOf(p, categories);
      byCat.set(id, [...(byCat.get(id) ?? []), p]);
    });
    const list: Group[] = categories.map((c) => ({ id: c.id, name: c.name, places: byCat.get(c.id) ?? [] }));
    const uncategorized = byCat.get(UNCATEGORIZED) ?? [];
    // 未分類はカテゴリがまだ無いとき、または未分類の地点があるときだけ出す
    if (uncategorized.length || !categories.length) list.push({ id: UNCATEGORIZED, name: UNCATEGORIZED_LABEL, places: uncategorized });
    return list;
  }, [places, categories]);

  // 削除された地点・カテゴリを選択状態や移動先から外す
  useEffect(() => {
    setChecked((prev) => {
      const alive = new Set(places.map((p) => p.id));
      const next = new Set([...prev].filter((id) => alive.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [places]);
  const effectiveMoveTarget = categories.some((c) => c.id === moveTarget) ? moveTarget : UNCATEGORIZED;

  const toggleChecked = (ids: string[], value: boolean) =>
    setChecked((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => (value ? next.add(id) : next.delete(id)));
      return next;
    });

  const exitSelectMode = () => {
    setSelectMode(false);
    setChecked(new Set());
  };

  const deleteGroup = (g: Group) => {
    const message =
      g.id === UNCATEGORIZED
        ? `未分類の ${g.places.length} 地点をすべて削除します。よろしいですか？`
        : g.places.length
          ? `カテゴリ「${g.name}」と、含まれる ${g.places.length} 地点をまとめて削除します。よろしいですか？`
          : `カテゴリ「${g.name}」を削除します。よろしいですか？`;
    if (window.confirm(message)) store.removeCategory(g.id);
  };

  const deleteChecked = () => {
    if (window.confirm(`選択した ${checked.size} 地点を削除します。よろしいですか？`)) {
      store.removePlaces([...checked]);
      setChecked(new Set());
    }
  };

  const moveChecked = () => {
    store.movePlaces([...checked], effectiveMoveTarget);
    setChecked(new Set());
  };

  const hiddenSet = new Set(hiddenCategoryIds);

  return (
    <div className="place-list" id="place-chip-list">
      <div className="list-toolbar">
        {creating ? (
          <CategoryNameForm
            submitLabel="作成"
            onSubmit={(name) => {
              const c = store.addCategory(name);
              onCategoryCreated(c.id);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        ) : (
          <button type="button" className="btn sm" onClick={() => setCreating(true)}>
            <Icon name="folder" size={14} />
            カテゴリを作成
          </button>
        )}
        <button
          type="button"
          className={selectMode ? 'btn sm is-on' : 'btn sm'}
          onClick={() => (selectMode ? exitSelectMode() : setSelectMode(true))}
          aria-pressed={selectMode}
          disabled={!places.length}
        >
          <Icon name="check" size={14} />
          {selectMode ? '選択を終了' : '選択して移動・削除'}
        </button>
      </div>

      {selectMode && (
        <div className="select-bar" role="group" aria-label="選択した地点の操作">
          <span>
            <b className="mono">{checked.size}</b> 地点を選択中
          </span>
          <span className="select-bar-move">
            <select
              className="select"
              value={effectiveMoveTarget}
              onChange={(e) => setMoveTarget(e.target.value)}
              aria-label="移動先のカテゴリ"
            >
              <CategoryOptions categories={categories} />
            </select>
            <button type="button" className="btn sm" onClick={moveChecked} disabled={!checked.size}>
              <Icon name="move" size={14} />
              へ移動
            </button>
          </span>
          <button type="button" className="btn sm danger" onClick={deleteChecked} disabled={!checked.size}>
            <Icon name="trash" size={14} />
            削除
          </button>
        </div>
      )}

      {places.length === 0 && !categories.length ? (
        <div className="muted">
          登録された観測地点はありません。上の検索・緯度経度入力・地図クリック、または KML / KMZ の読み込みから登録してください。
        </div>
      ) : (
        groups.map((g) => {
          const hidden = hiddenSet.has(g.id);
          const ids = g.places.map((p) => p.id);
          const checkedCount = ids.filter((id) => checked.has(id)).length;
          const classes = ['cat-group', hidden && 'is-hidden', dropTarget === g.id && 'is-drop-target'].filter(Boolean).join(' ');
          return (
            <div
              key={g.id}
              className={classes}
              onDragOver={(e) => {
                if (!e.dataTransfer.types.includes('Files')) return;
                e.preventDefault();
                setDropTarget(g.id);
              }}
              onDragLeave={(e) => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
              }}
              onDrop={(e) => {
                if (!e.dataTransfer.files.length) return;
                e.preventDefault();
                e.stopPropagation();
                setDropTarget(null);
                onDropFileTo(e.dataTransfer.files[0], g.id);
              }}
            >
              <div className="cat-head">
                {selectMode && (
                  <GroupCheckbox
                    total={ids.length}
                    checkedCount={checkedCount}
                    onChange={(v) => toggleChecked(ids, v)}
                    label={`${g.name}の地点をすべて選択`}
                  />
                )}
                <button
                  type="button"
                  className="cat-eye"
                  onClick={() => store.toggleCategoryVisible(g.id)}
                  aria-pressed={!hidden}
                  aria-label={hidden ? `${g.name}を地図に表示する` : `${g.name}を地図で非表示にする`}
                  title={hidden ? '地図に表示する' : '地図で非表示にする'}
                >
                  <Icon name={hidden ? 'eyeOff' : 'eye'} size={16} />
                </button>
                {renamingId === g.id ? (
                  <CategoryNameForm
                    initial={g.name}
                    submitLabel="保存"
                    onSubmit={(name) => {
                      store.renameCategory(g.id, name);
                      setRenamingId(null);
                    }}
                    onCancel={() => setRenamingId(null)}
                  />
                ) : (
                  <span className={g.id === UNCATEGORIZED ? 'cat-name is-uncategorized' : 'cat-name'}>
                    {g.id !== UNCATEGORIZED && <Icon name="folder" size={15} />}
                    {g.name}
                  </span>
                )}
                <span className="count-badge mono">{g.places.length}</span>
                {hidden && <span className="cat-hidden-tag">地図で非表示</span>}
                <span className="cat-actions">
                  <button
                    type="button"
                    className="icon-btn sm"
                    onClick={() => onImportTo(g.id)}
                    title={`${g.name}に KML / KMZ を読み込む`}
                    aria-label={`${g.name}に KML / KMZ を読み込む`}
                  >
                    <Icon name="upload" size={15} />
                  </button>
                  {g.id !== UNCATEGORIZED && (
                    <button
                      type="button"
                      className="icon-btn sm"
                      onClick={() => setRenamingId(g.id)}
                      title="名前を変更"
                      aria-label={`${g.name}の名前を変更`}
                    >
                      <Icon name="edit" size={15} />
                    </button>
                  )}
                  <button
                    type="button"
                    className="icon-btn sm danger"
                    onClick={() => deleteGroup(g)}
                    disabled={g.id === UNCATEGORIZED && !g.places.length}
                    title={g.id === UNCATEGORIZED ? '未分類の地点をすべて削除' : 'カテゴリと地点をまとめて削除'}
                    aria-label={g.id === UNCATEGORIZED ? '未分類の地点をすべて削除' : `${g.name}と地点をまとめて削除`}
                  >
                    <Icon name="trash" size={15} />
                  </button>
                </span>
              </div>

              {g.places.length === 0 ? (
                <div className="cat-empty muted">
                  地点はまだありません。登録先にこのカテゴリを選んで登録するか、KML / KMZ を読み込んでください（ここへドラッグ＆ドロップも可）。
                </div>
              ) : (
                <div className="place-chips">
                  {g.places.map((p) => {
                    const isChecked = checked.has(p.id);
                    const chipClass = ['place-chip', p.id === selectedId && 'active', selectMode && isChecked && 'is-checked']
                      .filter(Boolean)
                      .join(' ');
                    return (
                      <span key={p.id} className={chipClass}>
                        <button
                          type="button"
                          className="chip-select"
                          onClick={() => (selectMode ? toggleChecked([p.id], !isChecked) : onSelectPlace(p.id))}
                          aria-pressed={selectMode ? isChecked : undefined}
                        >
                          {selectMode && (
                            <span className="chip-check" aria-hidden>
                              {isChecked && <Icon name="check" size={11} />}
                            </span>
                          )}
                          {p.name} <span className="muted mono">{formatLatLon(p.lat, p.lon)}</span>
                        </button>
                        {!selectMode && (
                          <button
                            type="button"
                            className="chip-del"
                            onClick={() => store.removePlaces([p.id])}
                            title="削除"
                            aria-label={`${p.name}を削除`}
                          >
                            <Icon name="close" size={13} />
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

/** グループ内の地点の一括選択（一部だけ選択中は中間状態で表示） */
function GroupCheckbox({
  total,
  checkedCount,
  onChange,
  label,
}: {
  total: number;
  checkedCount: number;
  onChange: (value: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = checkedCount > 0 && checkedCount < total;
  }, [checkedCount, total]);
  return (
    <input
      ref={ref}
      type="checkbox"
      className="cat-check"
      checked={total > 0 && checkedCount === total}
      disabled={!total}
      onChange={(e) => onChange(e.target.checked)}
      aria-label={label}
    />
  );
}
