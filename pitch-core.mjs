// Copyright (C) 2026 xer5xer5
// SPDX-License-Identifier: AGPL-3.0-or-later
// Streaming STFT phase vocoder. One output sample per input clock tick;
// spectral frequencies shift while stream duration stays unchanged.
export class PitchShiftDSP {
  constructor(sampleRate=48000,semitones=0){
    this.rate=sampleRate;this.size=1024;this.hop=128;this.latency=this.size-this.hop;this.rover=this.latency;
    this.input=new Float64Array(this.size);this.output=new Float64Array(this.size);this.accum=new Float64Array(this.size*2);
    this.real=new Float64Array(this.size);this.imag=new Float64Array(this.size);this.lastPhase=new Float64Array(this.size/2+1);this.sumPhase=new Float64Array(this.size/2+1);
    this.magnitudes=new Float64Array(this.size/2+1);this.frequencies=new Float64Array(this.size/2+1);
    this.window=new Float64Array(this.size);for(let i=0;i<this.size;i++)this.window[i]=.5-.5*Math.cos(2*Math.PI*i/this.size);
    this.setPitch(semitones);
  }
  setPitch(semitones){this.semitones=Math.max(-12,Math.min(12,Number(semitones)||0));this.ratio=2**(this.semitones/12);}
  clear(){
    for(const value of Object.values(this))if(ArrayBuffer.isView(value))value.fill(0);
    this.rover=this.latency;
  }
  fft(inverse){
    const n=this.size,re=this.real,im=this.imag;
    for(let i=1,j=0;i<n;i++){let bit=n>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;if(i<j){let t=re[i];re[i]=re[j];re[j]=t;t=im[i];im[i]=im[j];im[j]=t;}}
    for(let length=2;length<=n;length<<=1){const angle=(inverse?2:-2)*Math.PI/length,wr0=Math.cos(angle),wi0=Math.sin(angle);
      for(let base=0;base<n;base+=length){let wr=1,wi=0;for(let j=0;j<length/2;j++){const a=base+j,b=a+length/2,tr=wr*re[b]-wi*im[b],ti=wr*im[b]+wi*re[b];re[b]=re[a]-tr;im[b]=im[a]-ti;re[a]+=tr;im[a]+=ti;const next=wr*wr0-wi*wi0;wi=wr*wi0+wi*wr0;wr=next;}}
    }
    if(inverse)for(let i=0;i<n;i++){re[i]/=n;im[i]/=n;}
  }
  frame(){
    const n=this.size,hop=this.hop,twoPi=2*Math.PI;
    for(let i=0;i<n;i++){this.real[i]=this.input[i]*this.window[i];this.imag[i]=0;}
    this.fft(false);this.magnitudes.fill(0);this.frequencies.fill(0);
    for(let k=0;k<=n/2;k++){
      const re=this.real[k],im=this.imag[k],magnitude=Math.hypot(re,im),phase=Math.atan2(im,re);
      let delta=phase-this.lastPhase[k]-twoPi*k*hop/n;this.lastPhase[k]=phase;delta-=twoPi*Math.round(delta/twoPi);
      const frequency=(k*this.rate/n+delta*this.rate/(twoPi*hop))*this.ratio,index=Math.round(k*this.ratio);
      if(index<=n/2){this.magnitudes[index]+=magnitude;this.frequencies[index]+=frequency*magnitude;}
    }
    this.real.fill(0);this.imag.fill(0);
    for(let k=0;k<=n/2;k++){
      const magnitude=this.magnitudes[k],frequency=magnitude?this.frequencies[k]/magnitude:k*this.rate/n;
      this.sumPhase[k]+=twoPi*hop*frequency/this.rate;
      this.sumPhase[k]%=twoPi;
      this.real[k]=magnitude*Math.cos(this.sumPhase[k]);this.imag[k]=magnitude*Math.sin(this.sumPhase[k]);
      if(k>0&&k<n/2){this.real[n-k]=this.real[k];this.imag[n-k]=-this.imag[k];}
    }
    this.fft(true);for(let i=0;i<n;i++)this.accum[i]+=this.window[i]*this.real[i]/3;
    for(let i=0;i<hop;i++)this.output[i]=this.accum[i];
    this.accum.copyWithin(0,hop,n+hop);this.accum.fill(0,n);
    this.input.copyWithin(0,hop,n);
  }
  process(sample){
    sample=Number.isFinite(sample)?sample:0;if(this.semitones===0)return sample;
    this.input[this.rover]=sample;const result=this.output[this.rover-this.latency];
    if(++this.rover===this.size){this.rover=this.latency;this.frame();}return Number.isFinite(result)?result:0;
  }
}
