#!/usr/bin/env python3
"""Multipart-upload the master to R2 via the S3 API and report how many Class A ops it took.
Env: R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
Usage: upload_master.py <file> <bucket> <key> [part_mb=100]
"""
import os, sys, time, math
import boto3
from boto3.s3.transfer import TransferConfig

src, bucket, key = sys.argv[1:4]
part_mb = int(sys.argv[4]) if len(sys.argv) > 4 else 100
acc = os.environ["R2_ACCOUNT_ID"]
s3 = boto3.client("s3", endpoint_url=f"https://{acc}.r2.cloudflarestorage.com",
                  aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                  aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")
size = os.path.getsize(src)
parts = math.ceil(size / (part_mb * 1024 * 1024))
cfg = TransferConfig(multipart_threshold=part_mb * 1024 * 1024, multipart_chunksize=part_mb * 1024 * 1024,
                     max_concurrency=4, use_threads=True)
t0 = time.time()
s3.upload_file(src, bucket, key, Config=cfg, ExtraArgs={"ContentType": "video/quicktime"})
dt = time.time() - t0
head = s3.head_object(Bucket=bucket, Key=key)
print(f"uploaded {size/1e9:.3f} GB in {dt:.0f} s ({size*8/dt/1e6:.1f} Mbps)")
print(f"parts={parts} -> Class A ops = CreateMultipartUpload 1 + UploadPart {parts} + CompleteMultipartUpload 1 = {parts+2}")
print(f"etag={head['ETag']} content_length={head['ContentLength']}")
