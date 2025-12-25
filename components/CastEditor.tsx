
import React, { useState } from 'react';
import { CastMember } from '../types';

interface CastEditorProps {
  cast: CastMember[];
  onUpdate: (newCast: CastMember[]) => void;
}

const CastEditor: React.FC<CastEditorProps> = ({ cast, onUpdate }) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [newDesc, setNewDesc] = useState('');

  const addMember = () => {
    const newMember: CastMember = {
      id: Date.now().toString(),
      name: 'New Character',
      description: 'Description here...'
    };
    onUpdate([...cast, newMember]);
  };

  const removeMember = (id: string) => {
    onUpdate(cast.filter(c => c.id !== id));
  };

  const saveEdit = (id: string) => {
    onUpdate(cast.map(c => c.id === id ? { ...c, name: newName, description: newDesc } : c));
    setEditingId(null);
  };

  const startEdit = (member: CastMember) => {
    setEditingId(member.id);
    setNewName(member.name);
    setNewDesc(member.description);
  };

  return (
    <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
      <div className="flex justify-between items-center mb-4">
        <h2 className="text-lg font-bold text-gray-800">Cast Reference</h2>
        <button 
          onClick={addMember}
          className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs px-3 py-1 rounded-full transition"
        >
          + Add Role
        </button>
      </div>
      <div className="space-y-3">
        {cast.map((member) => (
          <div key={member.id} className="p-3 bg-gray-50 rounded-lg border border-gray-100 group">
            {editingId === member.id ? (
              <div className="space-y-2">
                <input 
                  value={newName} 
                  onChange={(e) => setNewName(e.target.value)}
                  className="w-full text-sm font-bold p-1 border rounded"
                  placeholder="Name"
                />
                <textarea 
                  value={newDesc} 
                  onChange={(e) => setNewDesc(e.target.value)}
                  className="w-full text-xs p-1 border rounded"
                  rows={2}
                  placeholder="Description"
                />
                <div className="flex gap-2">
                  <button onClick={() => saveEdit(member.id)} className="text-xs text-green-600 font-bold">Save</button>
                  <button onClick={() => setEditingId(null)} className="text-xs text-gray-500">Cancel</button>
                </div>
              </div>
            ) : (
              <div>
                <div className="flex justify-between items-start">
                  <span className="font-bold text-sm text-gray-700">{member.name}</span>
                  <div className="opacity-0 group-hover:opacity-100 transition flex gap-2">
                    <button onClick={() => startEdit(member)} className="text-xs text-indigo-600 hover:underline">Edit</button>
                    <button onClick={() => removeMember(member.id)} className="text-xs text-red-500 hover:underline">Delete</button>
                  </div>
                </div>
                <p className="text-xs text-gray-500 leading-relaxed mt-1">{member.description}</p>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
};

export default CastEditor;
