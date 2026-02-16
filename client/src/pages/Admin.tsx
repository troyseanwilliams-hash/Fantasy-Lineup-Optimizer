import { useState } from "react";
import { Navigation } from "@/components/Navigation";
import { useCreateSlate, useBulkCreatePlayers } from "@/hooks/use-slates";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, Upload, FileJson } from "lucide-react";

const EXAMPLE_JSON = `[
  {
    "name": "Patrick Mahomes",
    "team": "KC",
    "position": "QB",
    "salary": 7800,
    "fppg": "24.5",
    "projectedPoints": "26.2",
    "opponent": "LV",
    "gameInfo": "KC @ LV 4:25PM"
  },
  {
    "name": "Travis Kelce",
    "team": "KC",
    "position": "TE",
    "salary": 6400,
    "fppg": "15.2",
    "projectedPoints": "18.5",
    "opponent": "LV",
    "gameInfo": "KC @ LV 4:25PM"
  }
]`;

export default function Admin() {
  const { mutate: createSlate, isPending: isCreatingSlate } = useCreateSlate();
  const { mutate: uploadPlayers, isPending: isUploading } = useBulkCreatePlayers();
  const { toast } = useToast();

  const [slateForm, setSlateForm] = useState({
    name: "",
    sport: "NFL",
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
        setSlateForm({ name: "", sport: "NFL", startTime: "" });
      },
      onError: (err) => toast({ title: "Error", description: err.message, variant: "destructive" })
    });
  };

  const handleUploadPlayers = (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const players = JSON.parse(uploadForm.jsonData);
      // Ensure slateId is attached to each player object before sending
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
    <div className="min-h-screen bg-background">
      <Navigation />
      
      <main className="max-w-4xl mx-auto px-4 py-12 space-y-12">
        {/* Create Slate Section */}
        <div className="bg-card rounded-2xl p-8 border border-border shadow-lg">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center">
              <Plus className="w-6 h-6 text-primary" />
            </div>
            <h2 className="text-2xl font-display font-bold text-white">Create New Slate</h2>
          </div>

          <form onSubmit={handleCreateSlate} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-2">
                <Label>Sport</Label>
                <Select 
                  value={slateForm.sport} 
                  onValueChange={(val) => setSlateForm(prev => ({ ...prev, sport: val }))}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select sport" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="NFL">NFL</SelectItem>
                    <SelectItem value="NBA">NBA</SelectItem>
                    <SelectItem value="MLB">MLB</SelectItem>
                    <SelectItem value="NHL">NHL</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              
              <div className="space-y-2">
                <Label>Slate Name</Label>
                <Input 
                  placeholder="e.g. Week 1 Main Slate" 
                  value={slateForm.name}
                  onChange={e => setSlateForm(prev => ({ ...prev, name: e.target.value }))}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label>Start Time</Label>
                <Input 
                  type="datetime-local" 
                  value={slateForm.startTime}
                  onChange={e => setSlateForm(prev => ({ ...prev, startTime: e.target.value }))}
                  required
                />
              </div>
            </div>

            <Button type="submit" disabled={isCreatingSlate} className="w-full">
              {isCreatingSlate ? <Loader2 className="animate-spin" /> : "Create Slate"}
            </Button>
          </form>
        </div>

        {/* Upload Players Section */}
        <div className="bg-card rounded-2xl p-8 border border-border shadow-lg">
           <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <Upload className="w-6 h-6 text-emerald-400" />
            </div>
            <h2 className="text-2xl font-display font-bold text-white">Seed Player Data</h2>
          </div>

          <form onSubmit={handleUploadPlayers} className="space-y-6">
            <div className="space-y-2">
              <Label>Target Slate ID</Label>
              <Input 
                placeholder="Enter Slate ID from above" 
                type="number"
                value={uploadForm.slateId}
                onChange={e => setUploadForm(prev => ({ ...prev, slateId: e.target.value }))}
                required
              />
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <Label>Player Data (JSON)</Label>
                <Button 
                  type="button" 
                  variant="ghost" 
                  size="xs" 
                  className="text-primary h-auto p-0"
                  onClick={() => setUploadForm(prev => ({ ...prev, jsonData: EXAMPLE_JSON }))}
                >
                  Load Example JSON
                </Button>
              </div>
              <Textarea 
                className="font-mono text-xs min-h-[300px]"
                placeholder="Paste JSON array of player objects..."
                value={uploadForm.jsonData}
                onChange={e => setUploadForm(prev => ({ ...prev, jsonData: e.target.value }))}
                required
              />
            </div>

            <Button type="submit" disabled={isUploading} variant="secondary" className="w-full">
              {isUploading ? <Loader2 className="animate-spin" /> : (
                <>
                  <FileJson className="w-4 h-4 mr-2" />
                  Upload Data
                </>
              )}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
