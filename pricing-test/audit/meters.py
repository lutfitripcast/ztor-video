import json, re, sys, urllib.request
from pathlib import Path
ACC="89a040897539ed3a26aad722df127442"; FROM="2026-09-20T00:00:00Z"; TO="2026-09-22T00:00:00Z"
TOKEN=re.search(r'^oauth_token\s*=\s*"([^"]+)"',(Path.home()/"Library/Preferences/.wrangler/config/default.toml").read_text(),re.M).group(1)
def gql(q):
    rq=urllib.request.Request("https://api.cloudflare.com/client/v4/graphql",method="POST",data=json.dumps({"query":q}).encode(),headers={"Authorization":f"Bearer {TOKEN}","Content-Type":"application/json"})
    d=json.load(urllib.request.urlopen(rq,timeout=90)); return d
CLASS_A={"ListBuckets","PutBucket","ListObjects","PutObject","CopyObject","CompleteMultipartUpload","CreateMultipartUpload","ListMultipartUploads","UploadPart","UploadPartCopy","ListParts","PutBucketEncryption","PutBucketCors","PutBucketLifecycleConfiguration","LifecycleStorageTierTransition","DeleteObject"}
out={}
# R2 ops per bucket (DeleteObject is free but listed), storage max per bucket per day
d=gql('''{ viewer { accounts(filter:{accountTag:"%s"}) {
  ops: r2OperationsAdaptiveGroups(limit:500, filter:{datetime_geq:"%s", datetime_leq:"%s"}) { dimensions { bucketName actionType actionStatus } sum { requests responseObjectSize } }
  storage: r2StorageAdaptiveGroups(limit:500, filter:{datetime_geq:"%s", datetime_leq:"%s"}) { dimensions { bucketName datetime } max { payloadSize objectCount } }
}}}'''%(ACC,FROM,TO,FROM,TO))
if d.get("errors"): print("R2 errors",d["errors"])
a=d["data"]["viewer"]["accounts"][0]
per={}
for g in a["ops"]:
    dm,s=g["dimensions"],g["sum"]; per.setdefault(dm["bucketName"],{}).setdefault(dm["actionType"],{}).setdefault(dm["actionStatus"],0); per[dm["bucketName"]][dm["actionType"]][dm["actionStatus"]]+=s["requests"]
print("== R2 operations 2026-09-20..21 by bucket")
totA=totB=0
for b,acts in per.items():
    A=sum(n for act,sts in acts.items() for st,n in sts.items() if act in CLASS_A and act!="DeleteObject"); Bc=sum(n for act,sts in acts.items() for st,n in sts.items() if act not in CLASS_A)
    dele=sum(n for st,n in acts.get("DeleteObject",{}).items()); totA+=A; totB+=Bc
    print(f"  {b:<16} ClassA={A:>7,} ClassB={Bc:>8,} Delete(free)={dele:,}  detail={ {act:sum(sts.values()) for act,sts in acts.items()} }")
print(f"  TOTAL ClassA={totA:,} ClassB={totB:,}  list cost A=${totA/1e6*4.5:.4f} B=${totB/1e6*0.36:.4f}")
out["r2_ops"]=per
# storage: max per bucket per day, plus latest
st={}
for g in a["storage"]:
    b=g["dimensions"]["bucketName"]; day=g["dimensions"]["datetime"][:10]; st.setdefault(b,{}).setdefault(day,[]).append((g["dimensions"]["datetime"],g["max"]["payloadSize"],g["max"]["objectCount"]))
print("== R2 storage (max payload per bucket per day, and latest sample)")
for b,days in st.items():
    for day,rows in sorted(days.items()):
        mx=max(rows,key=lambda r:r[1]); last=max(rows)
        print(f"  {b:<16} {day} peak={mx[1]/1e9:.3f} GB ({mx[2]} obj at {mx[0][11:16]})  latest={last[1]/1e9:.3f} GB ({last[2]} obj at {last[0][11:16]})")
out["r2_storage"]=st
# Workers invocations
d=gql('''{ viewer { accounts(filter:{accountTag:"%s"}) {
  w: workersInvocationsAdaptive(limit:100, filter:{datetime_geq:"%s", datetime_leq:"%s"}) { dimensions { scriptName status } sum { requests errors subrequests } quantiles { cpuTimeP50 cpuTimeP99 } }
}}}'''%(ACC,FROM,TO))
if d.get("errors"): print("Workers errors",d["errors"])
else:
    print("== Workers invocations"); tot=0
    for g in d["data"]["viewer"]["accounts"][0]["w"]:
        print(f"  {g['dimensions']['scriptName']:<14} {g['dimensions']['status']:<10} requests={g['sum']['requests']:,} errors={g['sum']['errors']} subrequests={g['sum']['subrequests']:,} cpuP50={g['quantiles']['cpuTimeP50']:.0f}us cpuP99={g['quantiles']['cpuTimeP99']:.0f}us"); tot+=g['sum']['requests']
    print(f"  TOTAL requests={tot:,}"); out["workers"]=d["data"]
# D1
d=gql('''{ viewer { accounts(filter:{accountTag:"%s"}) {
  d1: d1AnalyticsAdaptiveGroups(limit:100, filter:{datetime_geq:"%s", datetime_leq:"%s"}) { dimensions { databaseId } sum { readQueries writeQueries rowsRead rowsWritten } }
}}}'''%(ACC,FROM,TO))
if d.get("errors"): print("D1 errors",d["errors"])
else:
    print("== D1"); [print(f"  {g['dimensions']['databaseId'][:8]} readQ={g['sum']['readQueries']:,} writeQ={g['sum']['writeQueries']:,} rowsRead={g['sum']['rowsRead']:,} rowsWritten={g['sum']['rowsWritten']:,}") for g in d["data"]["viewer"]["accounts"][0]["d1"]]; out["d1"]=d["data"]
# KV
d=gql('''{ viewer { accounts(filter:{accountTag:"%s"}) {
  kv: kvOperationsAdaptiveGroups(limit:100, filter:{datetime_geq:"%s", datetime_leq:"%s"}) { dimensions { namespaceId actionType } sum { requests } }
}}}'''%(ACC,FROM,TO))
if d.get("errors"): print("KV errors",d["errors"])
else:
    print("== KV"); [print(f"  {g['dimensions']['namespaceId'][:8]} {g['dimensions']['actionType']} requests={g['sum']['requests']:,}") for g in d["data"]["viewer"]["accounts"][0]["kv"]]; out["kv"]=d["data"]
# Workflows
d=gql('''{ viewer { accounts(filter:{accountTag:"%s"}) {
  wf: workflowsAdaptiveGroups(limit:100, filter:{datetime_geq:"%s", datetime_leq:"%s"}) { dimensions { workflowName status } count sum { wallTime } }
}}}'''%(ACC,FROM,TO))
if d.get("errors"): print("Workflows errors",[e["message"][:200] for e in d["errors"]])
else:
    print("== Workflows"); [print(f"  {g['dimensions']}: count={g['count']} wallTime={g['sum']['wallTime']}") for g in d["data"]["viewer"]["accounts"][0]["wf"]]; out["workflows"]=d["data"]
json.dump(out,open("meters.json","w"),indent=1)
