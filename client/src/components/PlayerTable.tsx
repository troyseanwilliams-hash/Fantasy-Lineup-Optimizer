import { useState } from "react";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type SortingState,
  type ColumnFiltersState,
} from "@tanstack/react-table";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Lock, LockOpen, X, Search, Filter } from "lucide-react";
import { type Player } from "@shared/schema";
import { cn } from "@/lib/utils";

interface PlayerTableProps {
  players: Player[];
  lockedPlayerIds: number[];
  excludedPlayerIds: number[];
  onLock: (id: number) => void;
  onExclude: (id: number) => void;
  onProjectionChange: (id: number, value: string) => void;
  customProjections: Record<string, number>;
}

export function PlayerTable({ 
  players, 
  lockedPlayerIds, 
  excludedPlayerIds, 
  onLock, 
  onExclude,
  onProjectionChange,
  customProjections
}: PlayerTableProps) {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [globalFilter, setGlobalFilter] = useState("");

  const columns: ColumnDef<Player>[] = [
    {
      id: "actions",
      header: "Actions",
      cell: ({ row }) => {
        const player = row.original;
        const isLocked = lockedPlayerIds.includes(player.id);
        const isExcluded = excludedPlayerIds.includes(player.id);

        return (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 transition-colors",
                isLocked ? "text-primary bg-primary/10" : "text-muted-foreground hover:text-primary"
              )}
              onClick={() => onLock(player.id)}
              disabled={isExcluded}
            >
              {isLocked ? <Lock className="w-4 h-4" /> : <LockOpen className="w-4 h-4" />}
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className={cn(
                "h-8 w-8 transition-colors",
                isExcluded ? "text-destructive bg-destructive/10" : "text-muted-foreground hover:text-destructive"
              )}
              onClick={() => onExclude(player.id)}
              disabled={isLocked}
            >
              <X className="w-4 h-4" />
            </Button>
          </div>
        );
      },
      enableSorting: false,
    },
    {
      accessorKey: "position",
      header: "Pos",
      cell: info => <span className="font-mono font-bold text-primary/80">{info.getValue() as string}</span>,
    },
    {
      accessorKey: "name",
      header: "Player",
      cell: info => (
        <div className="flex flex-col">
          <span className="font-medium text-white">{info.getValue() as string}</span>
          <span className="text-xs text-muted-foreground">{info.row.original.gameInfo}</span>
        </div>
      ),
    },
    {
      accessorKey: "team",
      header: "Team",
      cell: info => <span className="text-xs uppercase font-bold text-muted-foreground">{info.getValue() as string}</span>,
    },
    {
      accessorKey: "opponent",
      header: "Opp",
      cell: info => <span className="text-xs uppercase text-muted-foreground">{info.getValue() as string}</span>,
    },
    {
      accessorKey: "salary",
      header: "Salary",
      cell: info => <span className="font-mono text-emerald-400">${(info.getValue() as number).toLocaleString()}</span>,
    },
    {
      accessorKey: "fppg",
      header: "FPPG",
      cell: info => <span className="font-mono text-muted-foreground">{info.getValue() as string}</span>,
    },
    {
      accessorKey: "projectedPoints",
      header: "Proj",
      cell: ({ row }) => {
        const player = row.original;
        const currentProj = customProjections[player.id.toString()] ?? player.projectedPoints;
        return (
          <Input
            className="w-16 h-8 font-mono text-right bg-black/20 border-white/10 focus:border-primary text-primary"
            type="number"
            value={currentProj}
            onChange={(e) => onProjectionChange(player.id, e.target.value)}
          />
        );
      },
    },
  ];

  const table = useReactTable({
    data: players,
    columns,
    state: {
      sorting,
      columnFilters,
      globalFilter,
    },
    onSortingChange: setSorting,
    onColumnFiltersChange: setColumnFilters,
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getSortedRowModel: getSortedRowModel(),
  });

  // Position filtering helper
  const uniquePositions = Array.from(new Set(players.map(p => p.position))).sort();

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center bg-card p-4 rounded-xl border border-border">
        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Search players..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9 bg-background/50 border-white/10"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button 
            variant="outline" 
            size="sm"
            onClick={() => table.getColumn("position")?.setFilterValue(undefined)}
            className={cn(
              "text-xs transition-colors", 
              !table.getColumn("position")?.getFilterValue() ? "bg-primary text-primary-foreground border-primary" : "text-muted-foreground"
            )}
          >
            ALL
          </Button>
          {uniquePositions.map(pos => (
            <Button
              key={pos}
              variant="outline"
              size="sm"
              onClick={() => table.getColumn("position")?.setFilterValue(pos)}
              className={cn(
                "text-xs transition-colors font-mono",
                table.getColumn("position")?.getFilterValue() === pos 
                  ? "bg-primary text-primary-foreground border-primary" 
                  : "text-muted-foreground border-white/10"
              )}
            >
              {pos}
            </Button>
          ))}
        </div>
      </div>

      <div className="rounded-xl border border-border bg-card overflow-hidden flex-1 relative">
        <div className="absolute inset-0 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 z-10 bg-card border-b border-border shadow-sm">
              {table.getHeaderGroups().map((headerGroup) => (
                <TableRow key={headerGroup.id} className="hover:bg-transparent border-border">
                  {headerGroup.headers.map((header) => (
                    <TableHead key={header.id} className="text-xs uppercase tracking-wider text-muted-foreground h-10">
                      {header.isPlaceholder
                        ? null
                        : flexRender(
                            header.column.columnDef.header,
                            header.getContext()
                          )}
                    </TableHead>
                  ))}
                </TableRow>
              ))}
            </TableHeader>
            <TableBody>
              {table.getRowModel().rows?.length ? (
                table.getRowModel().rows.map((row) => (
                  <TableRow
                    key={row.id}
                    data-state={row.getIsSelected() && "selected"}
                    className={cn(
                      "border-border/50 transition-colors",
                      lockedPlayerIds.includes(row.original.id) && "bg-primary/5 hover:bg-primary/10",
                      excludedPlayerIds.includes(row.original.id) && "opacity-50 grayscale hover:opacity-75 hover:grayscale-0"
                    )}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className="py-2">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : (
                <TableRow>
                  <TableCell
                    colSpan={columns.length}
                    className="h-24 text-center text-muted-foreground"
                  >
                    No players found.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
      
      <div className="flex items-center justify-between px-2">
        <div className="flex-1 text-sm text-muted-foreground">
          {table.getFilteredRowModel().rows.length} players found
        </div>
        <div className="space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
