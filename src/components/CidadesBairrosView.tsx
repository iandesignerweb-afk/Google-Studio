import React, { useState, useEffect } from 'react';
import { Cidade, Bairro, Quadra, User } from '../types';
import { api } from '../services/api';
import {
  Building2,
  MapPin,
  Plus,
  Edit2,
  Trash2,
  Grid3x3,
  CheckCircle2,
  AlertCircle,
  X,
  PlusCircle,
  ArrowRight,
  ChevronRight,
  Eye,
  User as UserIcon,
} from 'lucide-react';

interface CidadesBairrosViewProps {
  currentUser: User;
  darkMode: boolean;
  onNavigateToQuadras?: () => void;
}

export const CidadesBairrosView: React.FC<CidadesBairrosViewProps> = ({
  currentUser,
  darkMode,
  onNavigateToQuadras,
}) => {
  const isAdmin = currentUser.permissao === 'Administrador';

  const [cidades, setCidades] = useState<Cidade[]>([]);
  const [bairros, setBairros] = useState<Bairro[]>([]);
  const [bairroQuadraCounts, setBairroQuadraCounts] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);

  // Cidade Edit Modal
  const [showCidadeModal, setShowCidadeModal] = useState(false);
  const [cidadeNome, setCidadeNome] = useState('');

  // Bairro Form Modal
  const [showBairroModal, setShowBairroModal] = useState(false);
  const [editingBairro, setEditingBairro] = useState<Bairro | null>(null);
  const [bairroNome, setBairroNome] = useState('');

  // Delete Bairro Confirmation Modal
  const [bairroToDelete, setBairroToDelete] = useState<Bairro | null>(null);
  const [deletingBairro, setDeletingBairro] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Bairro Quadras Detail View Modal
  const [activeBairro, setActiveBairro] = useState<Bairro | null>(null);
  const [bairroQuadras, setBairroQuadras] = useState<Quadra[]>([]);
  const [loadingBairroQuadras, setLoadingBairroQuadras] = useState(false);
  const [deletingQuadraId, setDeletingQuadraId] = useState<number | null>(null);

  // Delete Quadra Confirmation Modal State
  const [quadraToDelete, setQuadraToDelete] = useState<Quadra | null>(null);
  const [deletingQuadra, setDeletingQuadra] = useState(false);
  const [deleteQuadraError, setDeleteQuadraError] = useState<string | null>(null);

  // Quadra Form Modal (Single or Bulk creation for a Bairro)
  const [showQuadraModal, setShowQuadraModal] = useState(false);
  const [selectedBairroForQuadra, setSelectedBairroForQuadra] = useState<Bairro | null>(null);
  const [quadraMode, setQuadraMode] = useState<'unica' | 'lote'>('unica');
  const [singleNumero, setSingleNumero] = useState('');
  const [bulkInicio, setBulkInicio] = useState('1');
  const [bulkFim, setBulkFim] = useState('30');
  const [quadraMsg, setQuadraMsg] = useState<string | null>(null);
  const [quadraError, setQuadraError] = useState<string | null>(null);
  const [savingQuadra, setSavingQuadra] = useState(false);

  const primaryCidade = cidades.length > 0 ? cidades[0] : null;

  const loadData = async () => {
    setLoading(true);
    try {
      const [cList, bList, qList] = await Promise.all([
        api.getCidades(),
        api.getBairros(),
        api.getQuadras(),
      ]);

      setCidades(cList);
      setBairros(bList);

      // Auto-trigger setup modal on first access if no city exists
      if (cList.length === 0 && isAdmin) {
        setShowCidadeModal(true);
      }

      // Compute quadra count per bairro
      const counts: Record<number, number> = {};
      qList.forEach((q) => {
        counts[q.bairroId] = (counts[q.bairroId] || 0) + 1;
      });
      setBairroQuadraCounts(counts);

      // If active bairro is currently open, refresh its quadras list
      if (activeBairro) {
        const updatedBairroQuadras = qList.filter((q) => q.bairroId === activeBairro.id);
        setBairroQuadras(updatedBairroQuadras);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Load quadras for specific Bairro when opened
  const handleOpenBairroQuadras = async (bairro: Bairro) => {
    setActiveBairro(bairro);
    setLoadingBairroQuadras(true);
    try {
      const qList = await api.getQuadras({ bairroId: String(bairro.id) });
      setBairroQuadras(qList);
    } catch (err) {
      console.error('Erro ao carregar quadras do bairro:', err);
    } finally {
      setLoadingBairroQuadras(false);
    }
  };

  // Delete a specific Quadra
  const handlePromptDeleteQuadra = (q: Quadra) => {
    setDeleteQuadraError(null);
    setQuadraToDelete(q);
  };

  const confirmDeleteQuadra = async () => {
    if (!quadraToDelete) return;
    setDeletingQuadra(true);
    setDeleteQuadraError(null);
    try {
      await api.deleteQuadra(quadraToDelete.id);
      const deletedId = quadraToDelete.id;
      setQuadraToDelete(null);
      await loadData();
      if (activeBairro) {
        const qList = await api.getQuadras({ bairroId: String(activeBairro.id) });
        setBairroQuadras(qList);
      }
    } catch (err: any) {
      setDeleteQuadraError(err.message || 'Erro ao excluir a quadra.');
    } finally {
      setDeletingQuadra(false);
    }
  };

  // Save Cidade (Create or Edit single City)
  const handleSaveCidade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cidadeNome.trim()) return;

    try {
      if (primaryCidade) {
        await api.updateCidade(primaryCidade.id, cidadeNome.trim());
      } else {
        await api.createCidade(cidadeNome.trim());
      }
      setShowCidadeModal(false);
      setCidadeNome('');
      loadData();
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar cidade.');
    }
  };

  // Save Bairro
  const handleSaveBairro = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bairroNome.trim() || !primaryCidade) return;

    try {
      if (editingBairro) {
        await api.updateBairro(editingBairro.id, {
          nome: bairroNome.trim(),
          cidadeId: primaryCidade.id,
        });
      } else {
        await api.createBairro(primaryCidade.id, bairroNome.trim());
      }
      setShowBairroModal(false);
      setBairroNome('');
      setEditingBairro(null);
      loadData();
    } catch (err: any) {
      alert(err.message || 'Erro ao salvar bairro.');
    }
  };

  const handlePromptDeleteBairro = (b: Bairro) => {
    setDeleteError(null);
    setBairroToDelete(b);
  };

  const confirmDeleteBairro = async () => {
    if (!bairroToDelete) return;
    setDeletingBairro(true);
    setDeleteError(null);
    try {
      await api.deleteBairro(bairroToDelete.id);
      if (activeBairro?.id === bairroToDelete.id) {
        setActiveBairro(null);
      }
      setBairroToDelete(null);
      await loadData();
    } catch (err: any) {
      setDeleteError(err.message || 'Não foi possível excluir o bairro.');
    } finally {
      setDeletingBairro(false);
    }
  };

  // Open Quadra Add Modal for specific Bairro
  const handleOpenAddQuadra = (b: Bairro) => {
    setSelectedBairroForQuadra(b);
    setQuadraMode('unica');
    setSingleNumero('');
    setBulkInicio('1');
    setBulkFim('30');
    setQuadraMsg(null);
    setQuadraError(null);
    setShowQuadraModal(true);
  };

  // Save Quadra (Single or Bulk)
  const handleSaveQuadra = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBairroForQuadra || !primaryCidade) return;

    setSavingQuadra(true);
    setQuadraMsg(null);
    setQuadraError(null);

    try {
      if (quadraMode === 'unica') {
        if (!singleNumero.trim()) {
          setQuadraError('Informe o número da quadra.');
          setSavingQuadra(false);
          return;
        }
        await api.createQuadra(
          primaryCidade.id,
          selectedBairroForQuadra.id,
          singleNumero.trim()
        );
        setQuadraMsg(`Quadra ${singleNumero} cadastrada com sucesso!`);
      } else {
        const start = Number(bulkInicio);
        const end = Number(bulkFim);
        if (isNaN(start) || isNaN(end) || start > end) {
          setQuadraError('Informe um intervalo inicial e final válido.');
          setSavingQuadra(false);
          return;
        }
        const res = await api.createQuadrasBulk(
          primaryCidade.id,
          selectedBairroForQuadra.id,
          start,
          end
        );
        setQuadraMsg(res.message);
      }

      await loadData();
      if (activeBairro && activeBairro.id === selectedBairroForQuadra.id) {
        const qList = await api.getQuadras({ bairroId: String(activeBairro.id) });
        setBairroQuadras(qList);
      }

      setTimeout(() => {
        setShowQuadraModal(false);
        setQuadraMsg(null);
      }, 1200);
    } catch (err: any) {
      setQuadraError(err.message || 'Erro ao cadastrar quadra(s).');
    } finally {
      setSavingQuadra(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Main City Header Card */}
      <div
        className={`p-6 rounded-2xl border transition-colors shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-4 ${
          darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
        }`}
      >
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-500">
            <Building2 className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                Município do Sistema (1 Permitido)
              </span>
            </div>
            <h2 className="text-xl font-extrabold mt-1">
              {primaryCidade ? primaryCidade.nome : 'Nenhum município cadastrado'}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              {primaryCidade
                ? 'Cadastre e gerencie os bairros e quadras para este município'
                : 'Cadastre a cidade principal para gerenciar seus bairros e quadras'}
            </p>
          </div>
        </div>

        {isAdmin && (
          <div>
            {primaryCidade ? (
              <button
                onClick={() => {
                  setCidadeNome(primaryCidade.nome);
                  setShowCidadeModal(true);
                }}
                className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white font-bold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer self-start sm:self-auto"
              >
                <Edit2 className="w-3.5 h-3.5" />
                Alterar Nome da Cidade
              </button>
            ) : (
              <button
                onClick={() => {
                  setCidadeNome('');
                  setShowCidadeModal(true);
                }}
                className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-md self-start sm:self-auto"
              >
                <Plus className="w-4 h-4" />
                Cadastrar Cidade Principal
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bairros Management Panel */}
      <div
        className={`p-6 rounded-2xl border transition-colors shadow-sm ${
          darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <div>
            <h3 className="font-bold text-base flex items-center gap-2">
              <MapPin className="w-5 h-5 text-emerald-500" />
              Bairros Cadastrados ({bairros.length})
            </h3>
            <p className="text-xs text-slate-400">
              {isAdmin
                ? 'Clique em um bairro para ver, adicionar ou excluir suas quadras'
                : 'Clique em um bairro para visualizar suas quadras'}
            </p>
          </div>

          {isAdmin && (
            <button
              onClick={() => {
                setEditingBairro(null);
                setBairroNome('');
                setShowBairroModal(true);
              }}
              className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-all flex items-center gap-2 shadow-md cursor-pointer self-start sm:self-auto"
            >
              <Plus className="w-4 h-4" />
              Cadastrar Novo Bairro
            </button>
          )}
        </div>

        {loading ? (
          <div className="py-12 text-center text-xs text-slate-400">
            Carregando lista de bairros...
          </div>
        ) : bairros.length === 0 ? (
          <div className="py-12 text-center text-xs text-slate-400 space-y-2">
            <p>Nenhum bairro cadastrado ainda.</p>
            <p className="text-emerald-500 font-bold">
              Clique no botão acima "Cadastrar Novo Bairro" para começar!
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {bairros.map((b) => {
              const countQuadras = bairroQuadraCounts[b.id] || 0;
              return (
                <div
                  key={b.id}
                  className={`p-5 rounded-2xl border transition-all flex flex-col justify-between group ${
                    darkMode
                      ? 'bg-slate-800/40 border-slate-700/60 hover:border-emerald-500/50 hover:bg-slate-800/80'
                      : 'bg-slate-50 border-slate-200 hover:border-emerald-500/50 hover:bg-slate-100/80'
                  }`}
                >
                  {/* Clickable Header/Body */}
                  <div
                    onClick={() => handleOpenBairroQuadras(b)}
                    className="cursor-pointer"
                  >
                    <div className="flex justify-between items-start gap-2 mb-3">
                      <div className="flex items-center gap-3">
                        <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-500 font-bold shrink-0 group-hover:scale-105 transition-transform">
                          <MapPin className="w-5 h-5" />
                        </div>
                        <div>
                          <h4 className="font-extrabold text-base leading-snug group-hover:text-emerald-500 transition-colors">
                            {b.nome}
                          </h4>
                          <span className="text-[11px] font-bold text-slate-400 flex items-center gap-1 mt-0.5">
                            <Grid3x3 className="w-3.5 h-3.5 text-emerald-500" />
                            {countQuadras} quadra(s) cadastrada(s)
                          </span>
                        </div>
                      </div>

                      {/* Edit & Delete Action Buttons (Admin only) */}
                      {isAdmin && (
                        <div
                          className="flex items-center gap-1"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <button
                            onClick={() => {
                              setEditingBairro(b);
                              setBairroNome(b.nome);
                              setShowBairroModal(true);
                            }}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-700 cursor-pointer transition-colors"
                            title="Editar Bairro"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handlePromptDeleteBairro(b)}
                            className="p-1.5 rounded-lg text-red-400 hover:text-red-300 hover:bg-red-500/10 cursor-pointer transition-colors"
                            title="Excluir Bairro"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions Footer for Bairro Card */}
                  <div className="pt-4 mt-2 border-t border-slate-200/10 flex items-center justify-between gap-2">
                    <button
                      onClick={() => handleOpenBairroQuadras(b)}
                      className="px-3 py-2 bg-emerald-600/10 hover:bg-emerald-600/20 text-emerald-500 border border-emerald-500/20 rounded-xl font-bold text-xs flex items-center gap-1.5 cursor-pointer transition-colors"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      Ver Quadras ({countQuadras})
                    </button>

                    {isAdmin && (
                      <button
                        onClick={() => handleOpenAddQuadra(b)}
                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs rounded-xl flex items-center gap-1.5 cursor-pointer transition-colors"
                      >
                        <PlusCircle className="w-3.5 h-3.5 text-emerald-400" />
                        Adicionar
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* DETAILED BAIRRO QUADRAS MODAL / DRAWER */}
      {activeBairro && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div
            className={`w-full max-w-4xl max-h-[90vh] rounded-3xl border p-6 shadow-2xl relative flex flex-col ${
              darkMode
                ? 'bg-slate-900 border-slate-800 text-slate-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            {/* Modal Header */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 mb-4 border-b border-slate-200/10">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-2xl bg-emerald-500/10 text-emerald-500">
                  <MapPin className="w-6 h-6" />
                </div>
                <div>
                  <span className="text-[10px] font-extrabold uppercase tracking-wider px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                    Bairro Selecionado
                  </span>
                  <h3 className="text-xl font-black mt-0.5">
                    Quadras do Bairro: {activeBairro.nome}
                  </h3>
                  <p className="text-xs text-slate-400 mt-0.5">
                    {bairroQuadras.length} quadra(s) cadastrada(s)
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 self-start sm:self-auto">
                {isAdmin && (
                  <button
                    onClick={() => handleOpenAddQuadra(activeBairro)}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-all flex items-center gap-2 cursor-pointer shadow-md"
                  >
                    <PlusCircle className="w-4 h-4" />
                    Adicionar Quadras
                  </button>
                )}
                <button
                  onClick={() => setActiveBairro(null)}
                  className="p-2 text-slate-400 hover:text-white rounded-xl hover:bg-slate-800 transition-colors cursor-pointer"
                >
                  <X className="w-6 h-6" />
                </button>
              </div>
            </div>

            {/* Modal Content - Quadras List */}
            <div className="flex-1 overflow-y-auto pr-1">
              {loadingBairroQuadras ? (
                <div className="py-16 text-center text-xs text-slate-400 flex flex-col items-center gap-3">
                  <div className="w-6 h-6 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
                  Carregando quadras do bairro...
                </div>
              ) : bairroQuadras.length === 0 ? (
                <div className="py-16 text-center text-xs text-slate-400 space-y-3">
                  <Grid3x3 className="w-10 h-10 text-slate-600 mx-auto" />
                  <p className="font-semibold text-slate-300">
                    Nenhuma quadra cadastrada para o bairro "{activeBairro.nome}".
                  </p>
                  {isAdmin && (
                    <button
                      onClick={() => handleOpenAddQuadra(activeBairro)}
                      className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl transition-all inline-flex items-center gap-2 cursor-pointer"
                    >
                      <PlusCircle className="w-4 h-4" />
                      Cadastrar Quadras Agora
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <div className="flex items-center justify-between mb-3 text-xs text-slate-400 px-1">
                    <span>
                      Total: <strong>{bairroQuadras.length}</strong> | Concluídas:{' '}
                      <strong className="text-emerald-500">
                        {bairroQuadras.filter((q) => q.status === 'Feita').length}
                      </strong>
                    </span>
                    {isAdmin && (
                      <span className="text-[11px]">
                        Clique na lixeira para excluir uma quadra individualmente
                      </span>
                    )}
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3">
                    {bairroQuadras.map((q) => {
                      const isFeita = q.status === 'Feita';
                      const isDeleting = deletingQuadraId === q.id;

                      return (
                        <div
                          key={q.id}
                          className={`relative p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between h-28 shadow-sm ${
                            isFeita
                              ? 'bg-emerald-600 border-emerald-500 text-white'
                              : 'bg-slate-800/80 border-slate-700 text-slate-200'
                          }`}
                        >
                          <div className="flex justify-between items-start">
                            <div>
                              <span className="text-xs font-bold text-emerald-200/80 uppercase block">
                                Quadra
                              </span>
                              <span className="text-2xl font-black tracking-tight leading-none">
                                {q.numero}
                              </span>
                            </div>

                            {isAdmin && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handlePromptDeleteQuadra(q);
                                }}
                                disabled={isDeleting}
                                className={`p-1.5 rounded-lg transition-colors cursor-pointer ${
                                  isFeita
                                    ? 'text-white/80 hover:text-white hover:bg-emerald-700'
                                    : 'text-red-400 hover:text-red-300 hover:bg-red-500/20'
                                }`}
                                title="Excluir Quadra"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>

                          <div className="mt-auto pt-2 border-t border-white/10">
                            {isFeita ? (
                              <p className="text-[10px] font-bold truncate flex items-center gap-1 text-emerald-100">
                                <CheckCircle2 className="w-3 h-3 text-white shrink-0" />
                                {q.usuarioNome || 'Concluída'}
                              </p>
                            ) : (
                              <span className="text-[10px] font-bold text-slate-400">
                                Pendente
                              </span>
                            )}
                          </div>

                          {isDeleting && (
                            <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-[1px] rounded-2xl flex items-center justify-center text-xs font-bold text-white">
                              Excluindo...
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="pt-4 mt-4 border-t border-slate-200/10 flex justify-end">
              <button
                onClick={() => setActiveBairro(null)}
                className="px-5 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold text-xs rounded-xl cursor-pointer"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cidade Edit/Create Modal */}
      {showCidadeModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl relative ${
              darkMode
                ? 'bg-slate-900 border-slate-800 text-slate-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-base font-bold">
                  {primaryCidade ? 'Renomear Cidade do Sistema' : 'Cadastrar Cidade Principal (Primeiro Acesso)'}
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  {primaryCidade
                    ? 'Edite o nome da cidade cadastrada no sistema.'
                    : 'Defina a cidade principal única para gerenciar o sistema.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowCidadeModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCidade} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Nome do Município
                </label>
                <input
                  type="text"
                  value={cidadeNome}
                  onChange={(e) => setCidadeNome(e.target.value)}
                  placeholder="Ex: Canapi"
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-semibold border ${
                    darkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                  required
                />
                <p className="text-[11px] text-slate-400 mt-1.5">
                  O sistema permite o cadastro de <strong>apenas 1 cidade principal</strong>.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowCidadeModal(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs cursor-pointer"
                >
                  Salvar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Bairro Modal */}
      {showBairroModal && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl relative ${
              darkMode
                ? 'bg-slate-900 border-slate-800 text-slate-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-base font-bold">
                {editingBairro ? 'Editar Bairro' : 'Cadastrar Novo Bairro'}
              </h3>
              <button
                onClick={() => setShowBairroModal(false)}
                className="text-slate-400 hover:text-white cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveBairro} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-300 mb-1">
                  Nome do Bairro
                </label>
                <input
                  type="text"
                  value={bairroNome}
                  onChange={(e) => setBairroNome(e.target.value)}
                  placeholder="Ex: Centro, Bairro Novo, Cajueiro..."
                  className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-semibold border ${
                    darkMode
                      ? 'bg-slate-800 border-slate-700 text-white'
                      : 'bg-slate-50 border-slate-200 text-slate-900'
                  }`}
                  required
                />
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowBairroModal(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs cursor-pointer"
                >
                  Salvar Bairro
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Delete Bairro Confirmation Modal */}
      {bairroToDelete && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl relative ${
              darkMode
                ? 'bg-slate-900 border-slate-800 text-slate-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-2xl">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold">Excluir Bairro</h3>
                <p className="text-xs text-slate-400">
                  Esta ação excluirá o bairro e suas quadras
                </p>
              </div>
            </div>

            {deleteError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {deleteError}
              </div>
            )}

            <div className="space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                Tem certeza que deseja excluir o bairro{' '}
                <strong className="text-white font-extrabold">"{bairroToDelete.nome}"</strong>?
              </p>

              <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-semibold flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-500" />
                <div>
                  <strong>Atenção:</strong> Todas as{' '}
                  <strong className="underline">
                    {bairroQuadraCounts[bairroToDelete.id] || 0} quadra(s)
                  </strong>{' '}
                  vinculadas a este bairro também serão excluídas permanentemente.
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setBairroToDelete(null);
                    setDeleteError(null);
                  }}
                  disabled={deletingBairro}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteBairro}
                  disabled={deletingBairro}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-xs transition-all flex justify-center items-center gap-2 cursor-pointer shadow-lg shadow-red-950/40"
                >
                  {deletingBairro ? (
                    'Excluindo...'
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Sim, Excluir Bairro
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Quadra Confirmation Modal */}
      {quadraToDelete && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-[70] flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl relative ${
              darkMode
                ? 'bg-slate-900 border-slate-800 text-slate-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex items-center gap-3 mb-4">
              <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-500 rounded-2xl">
                <Trash2 className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-extrabold">Excluir Quadra</h3>
                <p className="text-xs text-slate-400">
                  Esta ação excluirá a quadra do sistema
                </p>
              </div>
            </div>

            {deleteQuadraError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {deleteQuadraError}
              </div>
            )}

            <div className="space-y-4">
              <p className="text-xs text-slate-300 leading-relaxed">
                Tem certeza que deseja excluir a{' '}
                <strong className="text-white font-extrabold">Quadra {quadraToDelete.numero}</strong> do bairro{' '}
                <strong className="text-emerald-400 font-extrabold">"{quadraToDelete.bairroNome || activeBairro?.nome}"</strong>?
              </p>

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setQuadraToDelete(null);
                    setDeleteQuadraError(null);
                  }}
                  disabled={deletingQuadra}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={confirmDeleteQuadra}
                  disabled={deletingQuadra}
                  className="flex-1 py-2.5 bg-red-600 hover:bg-red-500 text-white font-bold rounded-xl text-xs transition-all flex justify-center items-center gap-2 cursor-pointer shadow-lg shadow-red-950/40"
                >
                  {deletingQuadra ? (
                    'Excluindo...'
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Sim, Excluir Quadra
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Quadra Creation Modal for Selected Bairro */}
      {showQuadraModal && selectedBairroForQuadra && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div
            className={`w-full max-w-md rounded-2xl border p-6 shadow-2xl relative ${
              darkMode
                ? 'bg-slate-900 border-slate-800 text-slate-100'
                : 'bg-white border-slate-200 text-slate-900'
            }`}
          >
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="text-base font-bold">Cadastrar Quadra(s)</h3>
                <p className="text-xs text-emerald-500 font-semibold">
                  Bairro: {selectedBairroForQuadra.nome}
                </p>
              </div>
              <button
                onClick={() => setShowQuadraModal(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {quadraMsg && (
              <div className="mb-4 p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-semibold flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 shrink-0" />
                {quadraMsg}
              </div>
            )}

            {quadraError && (
              <div className="mb-4 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-400 text-xs font-semibold flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                {quadraError}
              </div>
            )}

            <form onSubmit={handleSaveQuadra} className="space-y-4">
              {/* Mode Toggle */}
              <div className="grid grid-cols-2 gap-2 p-1 bg-slate-800 rounded-xl">
                <button
                  type="button"
                  onClick={() => setQuadraMode('unica')}
                  className={`py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    quadraMode === 'unica'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Quadra Única
                </button>
                <button
                  type="button"
                  onClick={() => setQuadraMode('lote')}
                  className={`py-2 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                    quadraMode === 'lote'
                      ? 'bg-emerald-600 text-white shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  Gerar em Lote (Sequência)
                </button>
              </div>

              {quadraMode === 'unica' ? (
                <div>
                  <label className="block text-xs font-bold text-slate-300 mb-1">
                    Número da Quadra
                  </label>
                  <input
                    type="text"
                    value={singleNumero}
                    onChange={(e) => setSingleNumero(e.target.value)}
                    placeholder="Ex: 59, 60, 12..."
                    className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-semibold border ${
                      darkMode
                        ? 'bg-slate-800 border-slate-700 text-white'
                        : 'bg-slate-50 border-slate-200 text-slate-900'
                    }`}
                    required
                  />
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">
                      Nº Inicial
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={bulkInicio}
                      onChange={(e) => setBulkInicio(e.target.value)}
                      className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-semibold border ${
                        darkMode
                          ? 'bg-slate-800 border-slate-700 text-white'
                          : 'bg-slate-50 border-slate-200 text-slate-900'
                      }`}
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-300 mb-1">
                      Nº Final
                    </label>
                    <input
                      type="number"
                      min="1"
                      value={bulkFim}
                      onChange={(e) => setBulkFim(e.target.value)}
                      className={`w-full px-3.5 py-2.5 rounded-xl text-xs font-semibold border ${
                        darkMode
                          ? 'bg-slate-800 border-slate-700 text-white'
                          : 'bg-slate-50 border-slate-200 text-slate-900'
                      }`}
                      required
                    />
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowQuadraModal(false)}
                  className="flex-1 py-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold rounded-xl text-xs cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingQuadra}
                  className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold rounded-xl text-xs cursor-pointer flex justify-center items-center"
                >
                  {savingQuadra ? 'Cadastrando...' : 'Salvar Quadra(s)'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
