/* A small, read-only recall → draft → clarify agent. Saving belongs to the UI. */
(function (root) {
  function create() {
    let owner, turns=[], revision=0;
    function reset() { owner=undefined;turns=[];revision++; }
    async function run({userId,transcript,previous,context,recall,think,signal}) {
      if(owner!==userId){reset();owner=userId;}
      const currentRevision=++revision;
      const cancelled=()=>signal?.aborted || currentRevision!==revision;
      if(cancelled())return null;
      const conversation=turns.map(turn=>({...turn}));
      const query=[...conversation.slice(-2).map(turn=>turn.user),transcript].join('\n');
      const diary=await recall({query,context,signal});
      if(cancelled())return null;
      const result=await think({transcript,previous,context:{...context,diary,
        activities:diary.activities.map(a=>({activity:a.activity,category:a.category})),conversation}});
      if(cancelled())return null;
      if(!result || typeof result.reply!=='string' || !Array.isArray(result.items) || !Array.isArray(result.reflections) || !Array.isArray(result.questions) || result.questions.some(q=>typeof q!=='string'))throw new Error('The assistant returned an invalid draft. Nothing was saved.');
      const question=result.questions.find(q=>q.trim()) || '';
      turns.push({user:transcript.slice(0,1000),assistant:result.reply.slice(0,300),question:question.slice(0,400)});
      turns=turns.slice(-3);
      return {draft:{reply:result.reply,questions:result.questions,items:result.items,reflections:result.reflections},diary,question};
    }
    return {run,reset};
  }
  const api={create};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.DayDiaryAgent=api;
})(typeof globalThis!=='undefined'?globalThis:this);
