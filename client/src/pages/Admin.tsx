import { useState } from "react";
import { Navigation } from "@/components/Navigation";
import { useCreateSlate, useBulkCreatePlayers } from "@/hooks/use-slates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Upload, FileJson, Database } from "lucide-react";
import { useMutation } from "@tanstack/react-query";

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

export default function Admin() {
  const { mutate: createSlate, isPending: isCreatingSlate } = useCreateSlate();
  const { mutate: uploadPlayers, isPending: isUploading } = useBulkCreatePlayers();
  const { toast } = useToast();

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

  const [slateForm, setSlateForm] = useState({
    name: "",
    sport: "NBA",
    startTime: "",
  });

  const [uploadForm, setUploadForm] = useState({
    slateId: "",
    jsonData: "",
  });

  const handleCreateSlate = (e: React.FormEvent) => {
    e.preventDefault();
    createSlate({
      name: slateForm.name,
      sport: slateForm.sport,
      startTime: new Date(slateForm.startTime),
    }, {
      onSuccess: (data) => {
        toast({ title: "Slate Created", description: `ID: ${data.id}` });
        setUploadForm(prev => ({ ...prev, slateId: String(data.id) }));
        setSlateForm({ name: "", sport: "NBA", startTime: "" });
      },
      onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" })
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
      
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
        <div className="card">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Plus className="w-6 h-6 text-[#10B981]" />
            </div>
            <h2 className="text-2xl font-bold text-white">Create New Slate</h2>
          </div>

          <form onSubmit={handleCreateSlate} className="space-y-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label className="text-slate-400">Sport</Label>
                <Select 
                  value={slateForm.sport} 
                  onValueChange={(val) => setSlateForm(prev => ({ ...prev, sport: val }))}
                >
                  <SelectTrigger className="bg-slate-900 border-slate-700">
                    <SelectValue placeholder="Select sport" />
                  </SelectTrigger>
                  <SelectContent className="bg-slate-900 border-slate-700 text-white">
                    <SelectItem value="NFL">NFL</SelectItem>
                    <SelectItem value="NBA">NBA</SelectItem>
                    <SelectItem value="MLB">MLB</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label className="text-slate-400">Slate Name</Label>
                <Input 
                  placeholder="e.g. NBA Main Slate" 
                  className="input-dark"
                  value={slateForm.name}
                  onChange={e => setSlateForm(prev => ({ ...prev, name: e.target.value }))}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label className="text-slate-400">Start Time</Label>
                <Input 
                  type="datetime-local" 
                  className="input-dark"
                  value={slateForm.startTime}
                  onChange={e => setSlateForm(prev => ({ ...prev, startTime: e.target.value }))}
                  required
                />
              </div>
            </div>

            <Button type="submit" disabled={isCreatingSlate} className="btn-primary w-full h-12 text-lg font-bold">
              {isCreatingSlate ? <Loader2 className="animate-spin" /> : "Create Slate"}
            </Button>
          </form>
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
