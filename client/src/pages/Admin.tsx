import { useState } from "react";
import { Navigation } from "@/components/Navigation";
import { useBulkCreatePlayers } from "@/hooks/use-slates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Upload, FileJson, Database, ShieldAlert, RefreshCw, Check } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";

const EXAMPLE_JSON = `[
  {
    "name": "LeBron James",
    "team": "LAL",
    "position": "SF/PF",
    "salary": 9800,
    "fppg": "48.5",
    "projectedPoints": "52.2",
    "opponent": "GSW",
    "gameInfo": "LAL @ GSW 10:00PM"
  },
  {
    "name": "Stephen Curry",
    "team": "GSW",
    "position": "PG",
    "salary": 10200,
    "fppg": "50.2",
    "projectedPoints": "54.5",
    "opponent": "LAL",
    "gameInfo": "LAL @ GSW 10:00PM"
  }
]`;

interface DKSlateOption {
  draftGroupId: number;
  gameCount: number;
  startTime: string;
  label: string;
  gameTypeId: number;
  alreadyImported: boolean;
}

export default function Admin() {
  const { mutate: uploadPlayers, isPending: isUploading } = useBulkCreatePlayers();
  const { toast } = useToast();

  const { data: user, isLoading: userLoading } = useQuery<any>({
    queryKey: ["/api/auth/user"],
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/seed", { method: "POST" });
      if (!res.ok) throw new Error("Seeding failed");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Success", description: "Database seeded with sample NFL and NBA slates." });
    }
  });

  const refreshMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/refresh-data", { method: "POST" });
      if (!res.ok) throw new Error("Refresh failed");
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Data Refreshed", description: data.message || "Live data updated from Ball Don't Lie API" });
    },
    onError: () => {
      toast({ title: "Refresh Failed", description: "Could not refresh data. Check API key.", variant: "destructive" });
    }
  });

  const [addSlateSport, setAddSlateSport] = useState("NBA");
  const [selectedDraftGroup, setSelectedDraftGroup] = useState("");

  const { data: availableSlates, isLoading: isLoadingSlates, refetch: refetchSlates } = useQuery<DKSlateOption[]>({
    queryKey: ["/api/admin/dk-slates", addSlateSport],
    enabled: !!addSlateSport,
  });

  const addSlateMutation = useMutation({
    mutationFn: async ({ sport, draftGroupId, name }: { sport: string; draftGroupId: number; name: string }) => {
      const res = await apiRequest("POST", "/api/admin/add-dk-slate", { sport, draftGroupId, name });
      return res.json();
    },
    onSuccess: (data: any) => {
      toast({ title: "Slate Added", description: data.message || `Imported ${data.playerCount} players` });
      setSelectedDraftGroup("");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/dk-slates"] });
      queryClient.invalidateQueries({ queryKey: ["/api/slates"] });
    },
    onError: (err: any) => {
      toast({ title: "Import Failed", description: err.message || "Could not import slate", variant: "destructive" });
    }
  });

  const [uploadForm, setUploadForm] = useState({
    slateId: "",
    jsonData: "",
  });

  if (userLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-emerald-400" />
      </div>
    );
  }

  if (!user?.isAdmin) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen gap-4">
        <ShieldAlert className="w-16 h-16 text-red-400" />
        <h1 className="text-2xl font-bold text-white">Access Denied</h1>
        <p className="text-slate-400">You need admin privileges to access this page.</p>
      </div>
    );
  }

  const handleAddSlate = () => {
    if (!selectedDraftGroup) return;
    const selected = availableSlates?.find(s => String(s.draftGroupId) === selectedDraftGroup);
    if (!selected) return;
    addSlateMutation.mutate({
      sport: addSlateSport,
      draftGroupId: selected.draftGroupId,
      name: `${addSlateSport} ${selected.label.split(" (")[0]}`,
    });
  };

  const handleUploadPlayers = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const players = JSON.parse(uploadForm.jsonData);
      const playersWithSlate = players.map((p: any) => ({ ...p, slateId: Number(uploadForm.slateId) }));
      
      uploadPlayers({
        slateId: Number(uploadForm.slateId),
        players: playersWithSlate
      }, {
        onSuccess: () => {
          toast({ title: "Success", description: "Players uploaded successfully" });
          setUploadForm(prev => ({ ...prev, jsonData: "" }));
        },
        onError: (err) => toast({ title: "Upload Failed", description: err.message, variant: "destructive" })
      });
    } catch (error) {
      toast({ title: "Invalid JSON", description: "Please check your format", variant: "destructive" });
    }
  };

  return (
    <div className="container mx-auto px-4 py-12 space-y-12">
      <div className="flex justify-between items-center">
        <h1 className="text-4xl font-bold text-white tracking-tight">Admin Control Center</h1>
        <div className="flex items-center gap-3">
          <Button 
            onClick={() => refreshMutation.mutate()} 
            disabled={refreshMutation.isPending}
            className="bg-amber-500 text-black font-bold hover:bg-amber-400"
            data-testid="button-refresh-data"
          >
            {refreshMutation.isPending ? <Loader2 className="animate-spin mr-2 w-4 h-4" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            Refresh Live Data
          </Button>
          <Button 
            onClick={() => seedMutation.mutate()} 
            disabled={seedMutation.isPending}
            variant="outline"
            className="border-slate-700 text-slate-300 hover:bg-slate-800"
          >
            {seedMutation.isPending ? <Loader2 className="animate-spin mr-2" /> : <Database className="w-4 h-4 mr-2" />}
            Seed Sample Data
          </Button>
        </div>
      </div>
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        <div className="card">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Plus className="w-6 h-6 text-[#10B981]" />
            </div>
            <h2 className="text-2xl font-bold text-white">Add New Slate</h2>
          </div>

          <div className="space-y-5">
            <div className="space-y-2">
              <Label className="text-slate-400">Sport</Label>
              <Select 
                value={addSlateSport} 
                onValueChange={(val) => {
                  setAddSlateSport(val);
                  setSelectedDraftGroup("");
                }}
              >
                <SelectTrigger className="bg-slate-900 border-slate-700" data-testid="select-add-slate-sport">
                  <SelectValue placeholder="Select sport" />
                </SelectTrigger>
                <SelectContent className="bg-slate-900 border-slate-700 text-white">
                  <SelectItem value="NBA">NBA</SelectItem>
                  <SelectItem value="NHL">NHL</SelectItem>
                  <SelectItem value="NFL">NFL</SelectItem>
                  <SelectItem value="MLB">MLB</SelectItem>
                  <SelectItem value="GOLF">GOLF</SelectItem>
                  <SelectItem value="SOCCER">SOCCER</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-slate-400">Available DraftKings Slates</Label>
              {isLoadingSlates ? (
                <div className="flex items-center gap-2 text-slate-500 py-3">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span className="text-sm">Loading slates from DraftKings...</span>
                </div>
              ) : !availableSlates || availableSlates.length === 0 ? (
                <div className="text-sm text-slate-500 py-3 px-3 rounded-lg bg-slate-900 border border-slate-700">
                  No classic DraftKings slates found for {addSlateSport}. Check back when DK publishes a slate.
                </div>
              ) : (
                <Select
                  value={selectedDraftGroup}
                  onValueChange={setSelectedDraftGroup}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700" data-testid="select-dk-slate">
                    <SelectValue placeholder="Select a DraftKings slate" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white">
                    {availableSlates.map(s => (
                      <SelectItem 
                        key={s.draftGroupId} 
                        value={String(s.draftGroupId)}
                        disabled={s.alreadyImported}
                      >
                        <span className="flex items-center gap-2">
                          {s.label}
                          {s.alreadyImported && (
                            <span className="text-[10px] font-bold bg-emerald-500/20 text-emerald-400 px-1.5 py-0.5 rounded">
                              Already Added
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {selectedDraftGroup && (
              <div className="rounded-lg bg-slate-900/50 border border-slate-700/50 px-4 py-3">
                <div className="text-sm text-slate-300">
                  {availableSlates?.find(s => String(s.draftGroupId) === selectedDraftGroup)?.label}
                </div>
                <div className="text-xs text-slate-500 mt-1">
                  DraftGroup ID: {selectedDraftGroup}
                </div>
              </div>
            )}

            <Button 
              onClick={handleAddSlate}
              disabled={!selectedDraftGroup || addSlateMutation.isPending}
              className="btn-primary w-full h-12 text-lg font-bold"
              data-testid="button-add-slate"
            >
              {addSlateMutation.isPending ? (
                <div className="flex items-center gap-2">
                  <Loader2 className="animate-spin w-5 h-5" />
                  Importing Players...
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  Add Slate
                </div>
              )}
            </Button>
          </div>
        </div>

        <div className="card">
           <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-blue-500/20 flex items-center justify-center">
              <Upload className="w-6 h-6 text-blue-400" />
            </div>
            <h2 className="text-2xl font-bold text-white">Import Player Pool</h2>
          </div>

          <form onSubmit={handleUploadPlayers} className="space-y-6">
            <div className="space-y-2">
              <Label className="text-slate-400">Target Slate ID</Label>
              <Input 
                placeholder="Enter Slate ID" 
                type="number"
                className="input-dark"
                value={uploadForm.slateId}
                onChange={e => setUploadForm(prev => ({ ...prev, slateId: e.target.value }))}
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label className="text-slate-400">Player Data (JSON)</Label>
                <button 
                  type="button" 
                  className="text-[#10B981] text-xs font-bold hover:underline"
                  onClick={() => setUploadForm(prev => ({ ...prev, jsonData: EXAMPLE_JSON }))}
                >
                  Load NBA Example
                </button>
              </div>
              <Textarea 
                className="input-dark font-mono text-xs min-h-[300px]"
                placeholder="Paste player JSON array..."
                value={uploadForm.jsonData}
                onChange={e => setUploadForm(prev => ({ ...prev, jsonData: e.target.value }))}
                required
              />
            </div>

            <Button type="submit" disabled={isUploading} className="w-full h-12 bg-slate-700 hover:bg-slate-600 text-white font-bold">
              {isUploading ? <Loader2 className="animate-spin" /> : (
                <div className="flex items-center">
                  <FileJson className="w-4 h-4 mr-2" />
                  Upload Player Data
                </div>
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
