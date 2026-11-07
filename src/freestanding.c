#include <stddef.h>
void *memcpy(void *d,const void *s,size_t n){unsigned char *dd=d;const unsigned char *ss=s;for(size_t i=0;i<n;i++)dd[i]=ss[i];return d;}
void *memset(void *d,int v,size_t n){unsigned char *dd=d;for(size_t i=0;i<n;i++)dd[i]=(unsigned char)v;return d;}
int memcmp(const void *a,const void *b,size_t n){const unsigned char *x=a,*y=b;for(size_t i=0;i<n;i++)if(x[i]!=y[i])return x[i]<y[i]?-1:1;return 0;}
